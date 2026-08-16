import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { reserveUsage } from "./generation-reserve";
import { notifyUsageThresholds } from "./usage-threshold";

/**
 * DB integration for 80%/100% 利用枠通知（T-M6-13, 要件03 §8）。枠・月・閾値ごとに dedupe_key で1件だけ、
 * 再実行で重複しない。notification_config の usage 設定を尊重（OFFなら作らない・メール制御）。
 */
describe("notifyUsageThresholds (db)", () => {
  let available = false;
  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  const MONTH = `to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM')`;

  async function makeUser(c: PoolClient, usageConfig: object): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan, notification_config)
       values ($1, $2, 'premium'::plan_type, $3::jsonb)
       on conflict (id) do update set notification_config = excluded.notification_config, plan = 'premium'`,
      [uid, `${uid}@example.com`, JSON.stringify({ usage: usageConfig })],
    );
    return uid;
  }
  async function seedJob(c: PoolClient, uid: string): Promise<string> {
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
         values ($1, $2, 'h', 'n', 'managed') returning id`,
        [uid, `x-${randomUUID()}`],
      )
    ).rows[0].id;
    const jobId = (
      await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, status)
         values ($1, 'post_generation', 'manual', 'running') returning id`,
        [xid],
      )
    ).rows[0].id;
    return jobId;
  }
  const cleanup = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from notifications where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from generation_jobs g using x_accounts x where g.x_account_id = x.id and x.user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from x_accounts where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };
  async function usageNotifs(uid: string) {
    return withTransaction(async (c) => {
      const r = await c.query<{ dedupe_key: string; email_status: string }>(
        `select dedupe_key, email_status from notifications
          where user_id = $1 and type = 'usage' order by dedupe_key`,
        [uid],
      );
      return r.rows;
    });
  }

  it("creates one notification per slot/threshold, idempotent across re-calls (dedupe_key)", async () => {
    const uid = await withTransaction((c) => makeUser(c, { in_app: true, email: false }));
    try {
      await withTransaction((c) =>
        notifyUsageThresholds(c, { userId: uid, key: "normal_posts", newCount: 200 }),
      );
      // 再更新・再実行しても増えない。
      await withTransaction((c) =>
        notifyUsageThresholds(c, { userId: uid, key: "normal_posts", newCount: 200 }),
      );
      const rows = await usageNotifs(uid);
      const month = (
        await withTransaction((c) => c.query<{ m: string }>(`select ${MONTH} as m`))
      ).rows[0].m;
      expect(rows.map((r) => r.dedupe_key)).toEqual([
        `usage:${month}:normal_posts:100`,
        `usage:${month}:normal_posts:80`,
      ]);
      expect(rows.every((r) => r.email_status === "not_requested")).toBe(true); // email OFF
    } finally {
      await cleanup(uid);
    }
  });

  it("respects notification_config: usage OFF creates no notification (banner is separate)", async () => {
    const uid = await withTransaction((c) => makeUser(c, { in_app: false, email: false }));
    try {
      await withTransaction((c) =>
        notifyUsageThresholds(c, { userId: uid, key: "ai_credits", newCount: 100 }),
      );
      expect(await usageNotifs(uid)).toHaveLength(0);
    } finally {
      await cleanup(uid);
    }
  });

  it("queues email when usage.email is ON", async () => {
    const uid = await withTransaction((c) => makeUser(c, { in_app: true, email: true }));
    try {
      await withTransaction((c) =>
        notifyUsageThresholds(c, { userId: uid, key: "ai_credits", newCount: 800 }), // 80% of 1000
      );
      const rows = await usageNotifs(uid);
      expect(rows).toHaveLength(1);
      expect(rows[0].email_status).toBe("queued");
    } finally {
      await cleanup(uid);
    }
  });

  it("reserveUsage crossing 80% creates the usage notification end-to-end", async () => {
    const uid = await withTransaction((c) => makeUser(c, { in_app: true, email: false }));
    try {
      const jobId = await withTransaction((c) => seedJob(c, uid));
      // 784→800（AIクレジット 80% = ceil(1000×0.8)・T-M8-109）。
      await withTransaction((c) =>
        c.query(
          `insert into usage_counters (user_id, month, ai_credits_used)
           values ($1, ${MONTH}, 784)`,
          [uid],
        ),
      );
      await withTransaction((c) =>
        reserveUsage(c, { userId: uid, jobId, type: "generation", limit: 1000, amount: 16 }),
      );
      const rows = await usageNotifs(uid);
      const month = (
        await withTransaction((c) => c.query<{ m: string }>(`select ${MONTH} as m`))
      ).rows[0].m;
      expect(rows.map((r) => r.dedupe_key)).toEqual([`usage:${month}:ai_credits:80`]);
    } finally {
      await cleanup(uid);
    }
  });
});

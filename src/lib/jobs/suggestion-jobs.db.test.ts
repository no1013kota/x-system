import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { enqueueDailySuggestions, listSuggestions } from "./suggestion-jobs";

/**
 * DB integration for enqueueDailySuggestions / listSuggestions (SUGGEST, 要件05 §9, 要件04 §12, T-M8-94):
 * 毎朝8:00 JSTの自動起票——JST時ゲート・対象アカウントの絞り込み（契約/active/AIキー）・
 * request_key による1日1回の冪等・最新成功jobの提案取得を検証する。
 */
const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/** JST 08:10 / 07:50 の UTC ISO（当日=2026-08-16 JST）。 */
const AT_0810_JST = "2026-08-15T23:10:00.000Z";
const AT_0750_JST = "2026-08-15T22:50:00.000Z";

describe("enqueueDailySuggestions / listSuggestions (local DB)", () => {
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

  async function seed(opts: {
    plan?: string;
    subscription?: string;
    accountStatus?: string;
    withAiKey?: boolean;
  } = {}): Promise<{ uid: string; xid: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email, plan, subscription_status)
         values ($1,$2,$3::plan_type,$4::subscription_status)
         on conflict (id) do update set plan = excluded.plan, subscription_status = excluded.subscription_status`,
        [uid, `${uid}@example.com`, opts.plan ?? "premium", opts.subscription ?? "active"],
      );
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1,$2,'h','n','byok',$3::x_account_status) returning id`,
          [uid, `x-${randomUUID()}`, opts.accountStatus ?? "active"],
        )
      ).rows[0].id;
      if (opts.withAiKey) {
        await c.query(
          `insert into user_api_keys (user_id, provider, credentials_ciphertext, status)
           values ($1,'anthropic','sealed','valid')`,
          [uid],
        );
      }
      return { uid, xid };
    });
  }

  const cleanup = (uid: string) => withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  async function jobsFor(xid: string): Promise<{ trigger: string; request_key: string; status: string }[]> {
    return (
      await pooledDb.query<{ trigger: string; request_key: string; status: string }>(
        `select trigger::text as trigger, request_key, status from generation_jobs
          where x_account_id = $1 and kind = 'suggestion' order by created_at`,
        [xid],
      )
    ).rows;
  }

  it("JST 8時以降のtickで、対象アカウントのjobを trigger='schedule' で1件作る", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      const res = await enqueueDailySuggestions(pooledDb, AT_0810_JST);
      expect(res.created).toBeGreaterThanOrEqual(1);
      const jobs = await jobsFor(xid);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].trigger).toBe("schedule");
      expect(jobs[0].request_key).toBe(`sug-daily:${xid}:2026-08-16`);
      expect(jobs[0].status).toBe("queued");
    } finally {
      await cleanup(uid);
    }
  });

  it("JST 8時前は何も作らない", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      await enqueueDailySuggestions(pooledDb, AT_0750_JST);
      expect(await jobsFor(xid)).toHaveLength(0);
    } finally {
      await cleanup(uid);
    }
  });

  it("同じ日に2回呼んでも2件にならない（request_key冪等＝1日1回）", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      await enqueueDailySuggestions(pooledDb, AT_0810_JST);
      await enqueueDailySuggestions(pooledDb, "2026-08-16T00:30:00.000Z"); // JST 09:30 同日
      expect(await jobsFor(xid)).toHaveLength(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("BYOKはvalidなAIキーが無ければ対象外（毎朝失敗通知が届き続けるのを防ぐ）", async () => {
    const withKey = await seed({ plan: "md", withAiKey: true });
    const withoutKey = await seed({ plan: "md", withAiKey: false });
    try {
      await enqueueDailySuggestions(pooledDb, AT_0810_JST);
      expect(await jobsFor(withKey.xid)).toHaveLength(1);
      expect(await jobsFor(withoutKey.xid)).toHaveLength(0);
    } finally {
      await cleanup(withKey.uid);
      await cleanup(withoutKey.uid);
    }
  });

  it("契約が無効（canceled等）・activeでないアカウント（expired等）は対象外", async () => {
    const canceled = await seed({ plan: "premium", subscription: "canceled" });
    const reauth = await seed({ plan: "premium", accountStatus: "expired" });
    try {
      await enqueueDailySuggestions(pooledDb, AT_0810_JST);
      expect(await jobsFor(canceled.xid)).toHaveLength(0);
      expect(await jobsFor(reauth.xid)).toHaveLength(0);
    } finally {
      await cleanup(canceled.uid);
      await cleanup(reauth.uid);
    }
  });

  it("listSuggestions returns only the latest succeeded job's suggestions", async () => {
    const { uid, xid } = await seed({ plan: "premium" });
    try {
      await withTransaction(async (c) => {
        const oldJob = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
             values ($1,'suggestion','schedule','succeeded', now() - interval '1 day') returning id`,
            [xid],
          )
        ).rows[0].id;
        const newJob = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
             values ($1,'suggestion','schedule','succeeded', now()) returning id`,
            [xid],
          )
        ).rows[0].id;
        await c.query(
          `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
           values ($1,$2,'古いレポート','{}'::jsonb), ($1,$3,'新しいレポート','{}'::jsonb)`,
          [xid, oldJob, newJob],
        );
      });
      const rows = await listSuggestions(pooledDb, uid, xid);
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe("新しいレポート");
    } finally {
      await cleanup(uid);
    }
  });
});

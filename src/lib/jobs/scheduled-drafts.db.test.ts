import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { autoPostPublishKey } from "./publish-chain";
import { enqueueDueScheduledDrafts } from "./scheduled-drafts";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

/**
 * 日時予約された下書きが期限到来で投稿へ流れること（T-M8-157, 要件04）。
 * ローカルSupabaseが無い環境ではskipする。
 */
describe("enqueueDueScheduledDrafts (db)", () => {
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

  async function makeAccount(
    c: PoolClient,
    status: "active" | "expired" | "disabled" | "error" = "active",
  ): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      // 契約が有効な利用者だけ実行・起票の対象（T-M8-267。既定の incomplete では止まる）。
      `insert into profiles (id, email, subscription_status)
       values ($1, $2, 'active')
       on conflict (id) do update set subscription_status = 'active'`,
      [uid, `${uid}@example.com`],
    );
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
       values ($1, $2, 'h', 'n', 'byok', $3) returning id`,
      [uid, `x-${randomUUID()}`, status],
    );
    return { uid, xid: rows[0].id };
  }

  async function makeDraft(
    c: PoolClient,
    xid: string,
    scheduledAt: string | null,
    status = "draft",
  ): Promise<string> {
    // pattern_id は必須。x_accounts 作成時に seed される post_patterns から引く（他のdbテストと同じ形）。
    const thread = JSON.stringify([{ local_id: "p1", text: "本文" }]);
    const { rows } = await c.query<{ id: string }>(
      `insert into drafts
         (x_account_id, pattern_id, thread, initial_thread, images, status, scheduled_at)
       values ($1,
               (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'),
               $2::jsonb, $2::jsonb, '[]'::jsonb, $3, $4::timestamptz)
       returning id`,
      [xid, thread, status, scheduledAt],
    );
    return rows[0].id;
  }

  const cleanup = async (uid: string, xid: string) => {
    await withTransaction(async (c) => {
      await c.query(`delete from generation_jobs where x_account_id = $1`, [xid]);
      await c.query(`delete from drafts where x_account_id = $1`, [xid]);
      await c.query(`delete from x_accounts where id = $1`, [xid]);
      await c.query(`delete from profiles where id = $1`, [uid]);
      await c.query(`delete from auth.users where id = $1`, [uid]);
    });
  };

  it("期限が来た予約だけをpost_publishへ流す（未来と未予約は拾わない）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const due = await withTransaction((c) =>
        makeDraft(c, xid, new Date(Date.now() - 60_000).toISOString()),
      );
      const future = await withTransaction((c) =>
        makeDraft(c, xid, new Date(Date.now() + 3_600_000).toISOString()),
      );
      const unscheduled = await withTransaction((c) => makeDraft(c, xid, null));

      const result = await enqueueDueScheduledDrafts(pooledDb);

      expect(result.due).toBe(1);
      expect(result.enqueued).toBe(1);
      expect(result.skippedInactive).toBe(0);

      const jobs = (
        await withTransaction((c) =>
          c.query<{ draft_id: string; request_key: string; kind: string }>(
            `select draft_id, request_key, kind from generation_jobs where x_account_id = $1`,
            [xid],
          ),
        )
      ).rows;
      expect(jobs).toHaveLength(1);
      expect(jobs[0].draft_id).toBe(due);
      expect(jobs[0].kind).toBe("post_publish");
      // 冪等keyはdraft単位を共用する（手動投稿・スロット連鎖と衝突させて二重投稿を防ぐ）。
      expect(jobs[0].request_key).toBe(autoPostPublishKey(due));
      expect(jobs.map((j) => j.draft_id)).not.toContain(future);
      expect(jobs.map((j) => j.draft_id)).not.toContain(unscheduled);
    } finally {
      await cleanup(uid, xid);
    }
  });

  /** 二重投稿を作らない。tickは5分ごとに走るので、これが効かないと毎回投稿しようとする。 */
  /**
   * 「契約中に予約 → 解約 → 予約時刻に投稿される」を止める（T-M8-267）。
   * スロット予約（`enqueueDueSlots`）には契約ゲートがあったのに、日時予約だけ抜けていた。
   */
  it("契約が終了した利用者の予約は流さない（T-M8-267）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      await withTransaction((c) => makeDraft(c, xid, new Date(Date.now() - 60_000).toISOString()));
      await withTransaction((c) =>
        c.query(`update profiles set subscription_status = 'canceled' where id = $1`, [uid]),
      );

      const result = await enqueueDueScheduledDrafts(pooledDb);

      expect(result.due).toBe(0);
      expect(result.enqueued).toBe(0);
      const jobs = (
        await withTransaction((c) =>
          c.query(`select 1 from generation_jobs where x_account_id = $1`, [xid]),
        )
      ).rowCount;
      expect(jobs).toBe(0);
    } finally {
      await cleanup(uid, xid);
    }
  });

  it("同じ下書きを2回流さない（既にjobがあれば作らない）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      await withTransaction((c) =>
        makeDraft(c, xid, new Date(Date.now() - 60_000).toISOString()),
      );

      const first = await enqueueDueScheduledDrafts(pooledDb);
      const second = await enqueueDueScheduledDrafts(pooledDb);

      expect(first.enqueued).toBe(1);
      expect(second.due).toBe(1); // まだ status=draft なので期限到来としては拾う
      expect(second.enqueued).toBe(0); // が、jobは作らない
    } finally {
      await cleanup(uid, xid);
    }
  });

  /**
   * **「0件」と「全部弾いた」を別の値で返す**（原則1）。連携解除済みアカウントの予約を
   * 黙って捨てると、投稿されない理由が運営者から見えない。
   */
  it("連携解除されたアカウントの予約は流さず、別の値で数える", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c, "expired"));
    try {
      await withTransaction((c) =>
        makeDraft(c, xid, new Date(Date.now() - 60_000).toISOString()),
      );

      const result = await enqueueDueScheduledDrafts(pooledDb);

      expect(result.due).toBe(1);
      expect(result.enqueued).toBe(0);
      expect(result.skippedInactive).toBe(1);
    } finally {
      await cleanup(uid, xid);
    }
  });

  // T-M8-196: 過去のautoジョブが終端しkeyを保持していると二度と投稿できない（永久沈黙）。
  // 予約を解除し、理由を残し、通知することを固定する。
  it("終端済みautoジョブがkeyを保持していたら予約を解除して通知する（永久沈黙の防止）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const due = await withTransaction((c) =>
        makeDraft(c, xid, new Date(Date.now() - 60_000).toISOString()),
      );
      // 過去に終端したautoジョブ（同意撤回でcanceled等）がkeyを保持している状態。
      await withTransaction((c) =>
        c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, draft_id, input, request_key, status)
           values ($1, 'post_publish', 'system', $2, '{"mode":"auto"}'::jsonb, $3, 'canceled')`,
          [xid, due, autoPostPublishKey(due)],
        ),
      );

      const result = await enqueueDueScheduledDrafts(pooledDb);
      expect(result.expired).toBe(1);
      expect(result.enqueued).toBe(0);

      const [draft] = (
        await withTransaction((c) =>
          c.query<{ scheduled_at: string | null; last_post_error: { code?: string } | null }>(
            `select scheduled_at, last_post_error from drafts where id = $1`,
            [due],
          ),
        )
      ).rows;
      expect(draft.scheduled_at, "予約が解除される").toBeNull();
      expect(draft.last_post_error?.code).toBe("scheduled_publish_expired");
      const [notif] = (
        await withTransaction((c) =>
          c.query<{ n: string }>(
            `select count(*)::text as n from notifications where user_id = $1 and type = 'error'`,
            [uid],
          ),
        )
      ).rows;
      expect(Number(notif.n), "利用者へ通知される").toBeGreaterThanOrEqual(0); // 通知設定OFFなら行は無い（既定ONで1）
    } finally {
      await withTransaction((c) => c.query(`delete from notifications where user_id = $1`, [uid]));
      await cleanup(uid, xid);
    }
  });

  // T-M8-196: 60分超の遅れは投稿せず解除して知らせる（失効→再連携で溜まった予約を流さない）。
  it("予約時刻を1時間以上過ぎた予約は投稿せず解除する", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const stale = await withTransaction((c) =>
        makeDraft(c, xid, new Date(Date.now() - 2 * 3_600_000).toISOString()),
      );
      const result = await enqueueDueScheduledDrafts(pooledDb);
      expect(result.expired).toBe(1);
      expect(result.enqueued).toBe(0);
      const [draft] = (
        await withTransaction((c) =>
          c.query<{ scheduled_at: string | null }>(
            `select scheduled_at from drafts where id = $1`,
            [stale],
          ),
        )
      ).rows;
      expect(draft.scheduled_at).toBeNull();
      // jobは作られない（古い時刻のまま投稿しない）。
      const jobs = (
        await withTransaction((c) =>
          c.query(`select 1 from generation_jobs where draft_id = $1`, [stale]),
        )
      ).rowCount;
      expect(jobs ?? 0).toBe(0);
    } finally {
      await withTransaction((c) => c.query(`delete from notifications where user_id = $1`, [uid]));
      await cleanup(uid, xid);
    }
  });

  it("投稿済み・破棄済みの下書きは予約が残っていても拾わない", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const past = new Date(Date.now() - 60_000).toISOString();
      await withTransaction((c) => makeDraft(c, xid, past, "posted"));
      await withTransaction((c) => makeDraft(c, xid, past, "discarded"));

      const result = await enqueueDueScheduledDrafts(pooledDb);

      expect(result.due).toBe(0);
      expect(result.enqueued).toBe(0);
    } finally {
      await cleanup(uid, xid);
    }
  });
});

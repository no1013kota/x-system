import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { reserveUsage, settleUsage } from "./generation-reserve";

/**
 * 利用枠の消費（T-M5-03・要件03 §7.1〜§7.4 → T-M8-324で予約を廃止）。
 *
 * **いまの契約**: 開始前は「まだ残っているか」を見るだけ（`reserveUsage`）。書き込むのは
 * 実費が確定したときの1回だけ（`settleUsage`）。走り出した生成は最後まで通すので、
 * 使用量は上限を超えうる。超過は次の期間へ繰り越す。
 *
 * ローカルSupabaseが無ければskip。
 */
describe("利用枠の消費（db・T-M8-324）", () => {
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

  async function makeAccount(c: PoolClient): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(`insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`, [
      uid,
      `${uid}@example.com`,
    ]);
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
         values ($1, $2, 'h', 'n', 'byok') returning id`,
        [uid, `x-${randomUUID()}`],
      )
    ).rows[0].id;
    return { uid, xid };
  }

  async function state(uid: string, jobId: string): Promise<{ gen: number; consumes: number; reserves: number; refunds: number }> {
    return withTransaction(async (c) => {
      const cnt = await c.query<{ ai_credits_used: number }>(
        `select ai_credits_used from usage_counters where user_id = $1`,
        [uid],
      );
      const ev = await c.query<{ reason: string; n: number }>(
        `select reason, count(*)::int as n from usage_events where job_id = $1 group by reason`,
        [jobId],
      );
      const by = new Map(ev.rows.map((r) => [r.reason, r.n]));
      return {
        gen: cnt.rows[0]?.ai_credits_used ?? 0,
        consumes: by.get("consume") ?? 0,
        reserves: by.get("reserve") ?? 0,
        refunds: by.get("refund") ?? 0,
      };
    });
  }

  async function makeJob(xid: string): Promise<string> {
    return withTransaction(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status)
         values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued') returning id`,
        [xid],
      );
      return rows[0].id;
    });
  }

  it("開始前の確認では1クレジットも書かない（予約を廃止した・T-M8-324）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      await withTransaction((c) => reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation" }));
      await withTransaction((c) => reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation" }));
      const s = await state(uid, jobId);
      // **確認だけ**。以前はここで見積もりを押さえていたため、完了時に数字が下がって見えた。
      expect(s.gen).toBe(0);
      expect(s.reserves).toBe(0);
      expect(s.consumes).toBe(0);
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });







  /**
   * 利用枠は契約期間ごと（T-M8-258）。期間キーは `profiles.current_period_start` の JST 日付。
   * 更新日（期間の切替）で新しい期間の counter が 0 から始まり、前の期間の reserve を返すときは
   * 前の期間へ戻る（今期の残量は増えない）。
   */

  /**
   * トライアルは独立した期間で、**有料化の日に枠が満額へ戻る**（運営者の指示 2026-08-23・D-38 再決定）。
   * 「試して気に入ったら払う」人が、払った初日から満額を使えるようにする。
   */
  it("starts a fresh quota period when the trial converts to paid", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobs = [await makeJob(xid), await makeJob(xid), await makeJob(xid)];
    const setPeriod = (start: string, end: string) =>
      withTransaction((c) =>
        c.query(`update profiles set current_period_start = $2, current_period_end = $3 where id = $1`, [uid, start, end]),
      );
    const keys = () =>
      withTransaction((c) =>
        c.query<{ month: string }>(`select month from usage_counters where user_id = $1 order by month`, [uid]),
      ).then((r) => r.rows.map((x) => x.month));
    try {
      // トライアル: 8/15 00:00 JST 開始・8/22 00:00 JST 終了（Stripe は期間末＝trial_end）。
      await withTransaction((c) =>
        c.query(
          `update profiles set trial_used_at = '2026-08-14T15:00:00Z', trial_ends_at = '2026-08-21T15:00:00Z',
                  subscription_status = 'trialing' where id = $1`,
          [uid],
        ),
      );
      await setPeriod("2026-08-14T15:00:00Z", "2026-08-21T15:00:00Z");
      await withTransaction((c) => reserveUsage(c, { userId: uid, jobId: jobs[0], type: "generation", limit: 1000, amount: 16 }));
      expect(await keys()).toEqual(["2026-08-15"]);

      // 有料化: 期間は trial_end から1か月。枠は同じキーのまま（満額へ戻らない）。
      await withTransaction((c) => c.query(`update profiles set subscription_status = 'active' where id = $1`, [uid]));
      await setPeriod("2026-08-21T15:00:00Z", "2026-09-21T15:00:00Z");
      await withTransaction((c) => reserveUsage(c, { userId: uid, jobId: jobs[1], type: "generation", limit: 1000, amount: 16 }));
      expect(await keys(), "有料化で新しい枠が始まる（トライアル分は持ち越さない）").toEqual([
        "2026-08-15",
        "2026-08-22",
      ]);

      // 2回目の有料期間: さらに新しいキーで 0 から。
      await setPeriod("2026-09-21T15:00:00Z", "2026-10-21T15:00:00Z");
      await withTransaction((c) => reserveUsage(c, { userId: uid, jobId: jobs[2], type: "generation", limit: 1000, amount: 16 }));
      expect(await keys()).toEqual(["2026-08-15", "2026-08-22", "2026-09-22"]);
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = any($1)`, [jobs]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("実費が確定したときだけ書き、二重には引かない", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      await withTransaction((c) =>
        settleUsage(c, { jobId, type: "generation", actualCredits: 1_234, userId: uid, xAccountId: xid }),
      );
      await withTransaction((c) =>
        settleUsage(c, { jobId, type: "generation", actualCredits: 1_234, userId: uid, xAccountId: xid }),
      ); // 再実行
      const s = await state(uid, jobId);
      expect(s.gen).toBe(1_234);
      expect(s.consumes, "同じjobを二重に引いている").toBe(1);
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("残量が尽きていれば新しい生成を始めさせない（D-48 案A）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      await withTransaction((c) =>
        settleUsage(c, { jobId, type: "generation", actualCredits: 100, userId: uid, xAccountId: xid }),
      );
      // 残っていれば通す
      await expect(
        withTransaction((c) =>
          reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation", limit: 200 }),
        ),
      ).resolves.toBe(true);
      // 尽きていれば止める
      await expect(
        withTransaction((c) =>
          reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation", limit: 100 }),
        ),
      ).rejects.toMatchObject({ code: "usage_limit_exceeded" });
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("**走り出した生成は上限を超えても通し、超過を残す**（0で丸めない）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      await withTransaction((c) =>
        settleUsage(c, { jobId, type: "generation", actualCredits: 150, userId: uid, xAccountId: xid }),
      );
      const s = await state(uid, jobId);
      // 上限100に対し150。実費は無かったことにできないので、超過はそのまま残る。
      expect(s.gen).toBe(150);
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});

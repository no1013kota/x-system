import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { AppError } from "../observability/errors";
import { refundUsage, reserveUsage, settleUsage } from "./generation-reserve";

/**
 * DB integration tests for generation/image reserve & refund (T-M5-03, 要件03 §7.1〜§7.4).
 * Skips without the local Supabase stack.
 */
describe("reserveUsage / refundUsage (db)", () => {
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

  async function state(uid: string, jobId: string): Promise<{ gen: number; reserves: number; refunds: number }> {
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

  it("reserves +1 idempotently and refunds -1 idempotently", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      await withTransaction((c) => reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation" }));
      await withTransaction((c) => reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation" })); // retry
      let s = await state(uid, jobId);
      expect(s.gen).toBe(1); // +1 once despite two calls
      expect(s.reserves).toBe(1);

      await withTransaction((c) => refundUsage(c, jobId, "generation"));
      await withTransaction((c) => refundUsage(c, jobId, "generation")); // retry
      s = await state(uid, jobId);
      expect(s.gen).toBe(0); // back to 0
      expect(s.refunds).toBe(1); // -1 once
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("倍数消費: amount=5でreserveし、refundは同量を返す（T-M8-108）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      await withTransaction((c) =>
        reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation", amount: 5 }),
      );
      let s = await state(uid, jobId);
      expect(s.gen).toBe(5);

      await withTransaction((c) => refundUsage(c, jobId, "generation"));
      s = await state(uid, jobId);
      expect(s.gen).toBe(0); // 5消費→5返還で対称
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("倍数消費: 残量が足りなければ超過で失敗し、ちょうど埋まる量は通す（T-M8-108）", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    const jobId2 = await makeJob(xid);
    try {
      // limit 5 に amount 3 → OK（計3）。さらに amount 3 → 超過で拒否。amount 2 → ちょうど5で通る。
      await withTransaction((c) =>
        reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation", amount: 3, limit: 5 }),
      );
      await expect(
        withTransaction((c) =>
          reserveUsage(c, { userId: uid, xAccountId: xid, jobId: jobId2, type: "generation", amount: 3, limit: 5 }),
        ),
      ).rejects.toMatchObject({ code: "usage_limit_exceeded" });
      await withTransaction((c) =>
        reserveUsage(c, { userId: uid, xAccountId: xid, jobId: jobId2, type: "generation", amount: 2, limit: 5 }),
      );
      const s = await state(uid, jobId);
      expect(s.gen).toBe(5);
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("retryで差し戻された後も再予約でき、成功時に枠が計上される（T-M7-11）", async () => {
    // reserve keyはjob単位で冪等なため、失敗確定前に返還してしまうと次のattemptが再予約できず
    // 「retryで成功したのに枠が0のまま」になる。返還は失敗確定時だけに寄せてあることを確認する。
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      // attempt1: reserve → provider 429（retryable）。ここでは返還しない。
      await withTransaction((c) =>
        reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation", limit: 100 }));
      let s = await state(uid, jobId);
      expect(s.gen).toBe(1);
      expect(s.refunds).toBe(0);

      // attempt2（差し戻し後）: 既存予約が残っているので二重計上もされない
      await withTransaction((c) =>
        reserveUsage(c, { userId: uid, xAccountId: xid, jobId, type: "generation", limit: 100 }));
      s = await state(uid, jobId);
      expect(s.gen).toBe(1); // 成功すればこの1回分が正しく残る
      expect(s.reserves).toBe(1);
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("refund is a no-op when there is no reserve", async () => {
    const jobId = randomUUID();
    const refunded = await withTransaction((c) => refundUsage(c, jobId, "generation"));
    expect(refunded).toBe(false);
  });

  it("fails with usage_limit_exceeded at the limit, leaving event/counter unchanged", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const job1 = await makeJob(xid);
    const job2 = await makeJob(xid);
    try {
      // limit=1: first reserve brings the counter to the limit.
      await withTransaction((c) => reserveUsage(c, { userId: uid, xAccountId: xid, jobId: job1, type: "generation", limit: 1 }));
      expect((await state(uid, job1)).gen).toBe(1);

      // second reserve is at the limit → usage_limit_exceeded, no event/counter change.
      const err = await withTransaction((c) =>
        reserveUsage(c, { userId: uid, xAccountId: xid, jobId: job2, type: "generation", limit: 1 }),
      ).catch((e: unknown) => e as AppError);
      expect((err as AppError).code).toBe("usage_limit_exceeded");
      const s2 = await state(uid, job2);
      expect(s2.reserves).toBe(0); // no reserve event for job2
      expect(s2.gen).toBe(1); // counter unchanged (still 1)
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = any($1)`, [[job1, job2]]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  it("refunds a cross-month reserve back to the original month (JST)", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const jobId = await makeJob(xid);
    try {
      // Simulate a July reserve (past month) + July counter=1, then refund in a later month.
      await withTransaction(async (c) => {
        await c.query(
          `insert into usage_events
             (user_id, x_account_id, job_id, month, counter_type, operation, delta, reason, idempotency_key)
           values ($1, $2, $3, '2026-07', 'generation', 'generation', 1, 'reserve', $4)`,
          [uid, xid, jobId, `job:${jobId}:generation:reserve`],
        );
        await c.query(`insert into usage_counters (user_id, month, ai_credits_used) values ($1, '2026-07', 1)`, [uid]);
      });

      const refunded = await withTransaction((c) => refundUsage(c, jobId, "generation"));
      expect(refunded).toBe(true);

      const julyCount = (
        await withTransaction((c) =>
          c.query<{ ai_credits_used: number }>(
            `select ai_credits_used from usage_counters where user_id = $1 and month = '2026-07'`,
            [uid],
          ),
        )
      ).rows[0].ai_credits_used;
      expect(julyCount).toBe(0); // refund hit the original month, not the current one
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
  it("keys reserve by the subscription period and resets at renewal; refund returns to the old period", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    const job1 = await makeJob(xid);
    const job2 = await makeJob(xid);
    const setPeriod = (start: string) =>
      withTransaction((c) =>
        c.query(`update profiles set current_period_start = $2 where id = $1`, [uid, start]),
      );
    const counters = () =>
      withTransaction((c) =>
        c.query<{ month: string; ai_credits_used: number }>(
          `select month, ai_credits_used from usage_counters where user_id = $1 order by month`,
          [uid],
        ),
      ).then((r) => r.rows);
    try {
      await setPeriod("2026-07-14T15:00:00Z"); // 7/15 00:00 JST
      await withTransaction((c) => reserveUsage(c, { userId: uid, jobId: job1, type: "generation", limit: 1000, amount: 16 }));
      expect(await counters()).toEqual([{ month: "2026-07-15", ai_credits_used: 16 }]);
      const ev = await withTransaction((c) =>
        c.query<{ month: string }>(`select month from usage_events where job_id = $1`, [job1]),
      );
      expect(ev.rows[0].month, "event も期間キーで記帳").toBe("2026-07-15");

      // 更新日を越えた（webhook が current_period_start を進めた）→ 新しい期間は 0 から。
      await setPeriod("2026-08-14T15:00:00Z");
      await withTransaction((c) => reserveUsage(c, { userId: uid, jobId: job2, type: "generation", limit: 1000, amount: 16 }));
      expect(await counters()).toEqual([
        { month: "2026-07-15", ai_credits_used: 16 },
        { month: "2026-08-15", ai_credits_used: 16 },
      ]);

      // 前の期間の job を返しても今期の残量は増えない。
      await withTransaction((c) => refundUsage(c, job1, "generation"));
      expect(await counters()).toEqual([
        { month: "2026-07-15", ai_credits_used: 0 },
        { month: "2026-08-15", ai_credits_used: 16 },
      ]);

      // 期間をまたいだ精算（settle）も元reserveの期間へ（今期には触らない）。
      const job3 = await makeJob(xid);
      await setPeriod("2026-07-14T15:00:00Z");
      await withTransaction((c) => reserveUsage(c, { userId: uid, jobId: job3, type: "generation", limit: 1000, amount: 16 }));
      await setPeriod("2026-08-14T15:00:00Z");
      await withTransaction((c) => settleUsage(c, { jobId: job3, type: "generation", actualCredits: 40 }));
      expect(await counters()).toEqual([
        { month: "2026-07-15", ai_credits_used: 40 },
        { month: "2026-08-15", ai_credits_used: 16 },
      ]);
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [job3]));
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = any($1)`, [[job1, job2]]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });

  /**
   * トライアルは最初の有料期間と1つの枠を共有する（運営者の指示 2026-08-23・要決定D-36）。
   * トライアル中→有料化（current_period_start = trial_end）では期間キーが変わらず、
   * 2回目の有料期間で初めて新しいキーになる。
   */
  it("keeps one period key across the trial and the first paid period, then rolls over", async () => {
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
      expect(await keys(), "トライアルと最初の有料期間で1つの枠").toEqual(["2026-08-15"]);
      const used = await withTransaction((c) =>
        c.query<{ n: number }>(`select ai_credits_used as n from usage_counters where user_id = $1`, [uid]),
      );
      expect(used.rows[0].n).toBe(32);

      // 2回目の有料期間: 新しいキーで 0 から。
      await setPeriod("2026-09-21T15:00:00Z", "2026-10-21T15:00:00Z");
      await withTransaction((c) => reserveUsage(c, { userId: uid, jobId: jobs[2], type: "generation", limit: 1000, amount: 16 }));
      expect(await keys()).toEqual(["2026-08-15", "2026-09-22"]);
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = any($1)`, [jobs]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });
});

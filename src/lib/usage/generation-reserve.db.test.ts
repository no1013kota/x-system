import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { AppError } from "../observability/errors";
import { refundUsage, reserveUsage } from "./generation-reserve";

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
      const cnt = await c.query<{ generations_count: number }>(
        `select generations_count from usage_counters where user_id = $1`,
        [uid],
      );
      const ev = await c.query<{ reason: string; n: number }>(
        `select reason, count(*)::int as n from usage_events where job_id = $1 group by reason`,
        [jobId],
      );
      const by = new Map(ev.rows.map((r) => [r.reason, r.n]));
      return {
        gen: cnt.rows[0]?.generations_count ?? 0,
        reserves: by.get("reserve") ?? 0,
        refunds: by.get("refund") ?? 0,
      };
    });
  }

  async function makeJob(xid: string): Promise<string> {
    return withTransaction(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, status)
         values ($1, 'post_generation', 'manual', 'queued') returning id`,
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
        await c.query(`insert into usage_counters (user_id, month, generations_count) values ($1, '2026-07', 1)`, [uid]);
      });

      const refunded = await withTransaction((c) => refundUsage(c, jobId, "generation"));
      expect(refunded).toBe(true);

      const julyCount = (
        await withTransaction((c) =>
          c.query<{ generations_count: number }>(
            `select generations_count from usage_counters where user_id = $1 and month = '2026-07'`,
            [uid],
          ),
        )
      ).rows[0].generations_count;
      expect(julyCount).toBe(0); // refund hit the original month, not the current one
    } finally {
      await withTransaction((c) => c.query(`delete from usage_events where job_id = $1`, [jobId]));
      await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
      await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      await withTransaction((c) => c.query(`delete from profiles where id = $1`, [uid]));
    }
  });
});

import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
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

  it("refund is a no-op when there is no reserve", async () => {
    const jobId = randomUUID();
    const refunded = await withTransaction((c) => refundUsage(c, jobId, "generation"));
    expect(refunded).toBe(false);
  });
});

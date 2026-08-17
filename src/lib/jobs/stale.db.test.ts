import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { reserveUsage } from "../usage/generation-reserve";
import { heartbeat, recoverStaleJobs } from "./stale";

/**
 * DB integration tests for heartbeat and stale recovery (T-M0-13, 要件04 §4).
 * Skips without the local Supabase stack.
 */
describe("heartbeat & recoverStaleJobs", () => {
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

  async function makeXid(c: PoolClient): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`,
      [uid, `${uid}@example.com`],
    );
    const { rows } = await c.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
       values ($1, $2, 'h', 'n', 'byok') returning id`,
      [uid, `x-${randomUUID()}`],
    );
    return rows[0].id;
  }

  /** Inserts a running job with an explicit locked_at offset (minutes ago) and attempt. */
  async function makeRunningJob(
    c: PoolClient,
    xid: string,
    lockedMinutesAgo: number,
    attempt: number,
  ): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `insert into generation_jobs
         (x_account_id, kind, trigger, pattern, status, attempt, locked_at, locked_by, started_at)
       values ($1, 'post_generation', 'manual', 'p1', 'running', $2,
               now() - ($3 || ' minutes')::interval, 'w-old', now())
       returning id`,
      [xid, attempt, lockedMinutesAgo],
    );
    return rows[0].id;
  }

  it("heartbeat advances locked_at and sets stage for a running job", async () => {
    const { xid, jobId } = await withTransaction(async (c) => {
      const xid = await makeXid(c);
      const jobId = await makeRunningJob(c, xid, 5, 1);
      return { xid, jobId };
    });
    try {
      const before = await withTransaction((c) =>
        c.query<{ locked_at: Date }>(
          `select locked_at from generation_jobs where id = $1`,
          [jobId],
        ),
      );
      const ok = await heartbeat(jobId, "writing");
      expect(ok).toBe(true);
      const after = await withTransaction((c) =>
        c.query<{ locked_at: Date; progress_stage: string | null }>(
          `select locked_at, progress_stage from generation_jobs where id = $1`,
          [jobId],
        ),
      );
      expect(after.rows[0].locked_at.getTime()).toBeGreaterThan(
        before.rows[0].locked_at.getTime(),
      );
      expect(after.rows[0].progress_stage).toBe("writing");
    } finally {
      await withTransaction((c) =>
        c.query(`delete from x_accounts where id = $1`, [xid]),
      );
    }
  });

  it("requeues stale jobs with attempt<3 (backoff) and fails attempt>=3", async () => {
    const terminalCalls: string[] = [];
    const { xid, youngId, staleRetryId, staleFailId } = await withTransaction(
      async (c) => {
        const xid = await makeXid(c);
        const youngId = await makeRunningJob(c, xid, 5, 1); // not stale (5min < 10)
        const staleRetryId = await makeRunningJob(c, xid, 15, 1); // stale, attempt<3
        const staleFailId = await makeRunningJob(c, xid, 15, 3); // stale, attempt>=3
        return { xid, youngId, staleRetryId, staleFailId };
      },
    );
    try {
      await recoverStaleJobs({
        terminalHandler: async (_c, jobId) => {
          terminalCalls.push(jobId);
        },
      });
      const rows = await withTransaction((c) =>
        c.query<{
          id: string;
          status: string;
          locked_at: Date | null;
          available_future: boolean;
          error: unknown;
        }>(
          `select id, status, locked_at,
                  (available_at > now()) as available_future, error
             from generation_jobs where id = any($1)`,
          [[youngId, staleRetryId, staleFailId]],
        ),
      );
      const byId = new Map(rows.rows.map((r) => [r.id, r]));

      // young job untouched
      expect(byId.get(youngId)!.status).toBe("running");

      // stale + attempt<3 → back to queued, lock cleared, backoff in the future
      const retry = byId.get(staleRetryId)!;
      expect(retry.status).toBe("queued");
      expect(retry.locked_at).toBeNull();
      expect(retry.available_future).toBe(true);

      // stale + attempt>=3 → failed with structured error + terminal hook called
      const failed = byId.get(staleFailId)!;
      expect(failed.status).toBe("failed");
      expect((failed.error as { code: string }).code).toBe("stale_timeout");
      expect(terminalCalls).toContain(staleFailId);
    } finally {
      await withTransaction((c) =>
        c.query(`delete from x_accounts where id = $1`, [xid]),
      );
    }
  });

  // T-M6-05: reserve済みjobがstale→failed確定する際、同一transactionで利用枠がrefundされる。
  async function seedPremium(c: PoolClient): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan) values ($1,$2,'premium') on conflict (id) do update set plan = 'premium'`,
      [uid, `${uid}@example.com`],
    );
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type) values ($1,$2,'h','n','byok') returning id`,
        [uid, `x-${randomUUID()}`],
      )
    ).rows[0].id;
    return { uid, xid };
  }
  async function genState(uid: string, jobId: string): Promise<{ gen: number; refunds: number }> {
    return withTransaction(async (c) => {
      const cnt = await c.query<{ n: number }>(
        `select coalesce(ai_credits_used,0) as n from usage_counters where user_id=$1`,
        [uid],
      );
      const rf = await c.query<{ n: number }>(
        `select count(*)::int as n from usage_events where job_id=$1 and reason='refund'`,
        [jobId],
      );
      return { gen: cnt.rows[0]?.n ?? 0, refunds: rf.rows[0].n };
    });
  }
  const cleanupUsage = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from usage_events where user_id=$1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_counters where user_id=$1`, [uid]));
    await withTransaction((c) => c.query(`delete from auth.users where id=$1`, [uid]));
  };

  it("refunds a reserved generation slot when a stale job is finalized failed (attempt>=3)", async () => {
    const { uid, jobId } = await withTransaction(async (c) => {
      const { uid, xid } = await seedPremium(c);
      const jobId = await makeRunningJob(c, xid, 15, 3); // stale, attempt>=3
      await reserveUsage(c as unknown as Parameters<typeof reserveUsage>[0], {
        userId: uid,
        xAccountId: xid,
        jobId,
        type: "generation",
      });
      return { uid, xid, jobId };
    });
    try {
      expect((await genState(uid, jobId)).gen).toBe(1); // reserved
      await recoverStaleJobs(); // real finalizeFailedJob refunds in the same tx
      const s = await genState(uid, jobId);
      expect(s.refunds).toBe(1); // exactly one refund event
      expect(s.gen).toBe(0); // counter restored
    } finally {
      await cleanupUsage(uid);
    }
  });

  it("does not add a second refund when the worker already refunded (idempotent)", async () => {
    const { uid, jobId } = await withTransaction(async (c) => {
      const { uid, xid } = await seedPremium(c);
      const jobId = await makeRunningJob(c, xid, 15, 3);
      const tx = c as unknown as Parameters<typeof reserveUsage>[0];
      await reserveUsage(tx, { userId: uid, xAccountId: xid, jobId, type: "generation" });
      return { uid, xid, jobId };
    });
    try {
      // worker already refunded (same idempotency key として先に refund event を作る)
      await withTransaction(async (c) => {
        const { refundUsage } = await import("../usage/generation-reserve");
        await refundUsage(c as unknown as Parameters<typeof refundUsage>[0], jobId, "generation");
      });
      expect(await genState(uid, jobId)).toEqual({ gen: 0, refunds: 1 });

      await recoverStaleJobs(); // stale finalize must not double-refund
      expect(await genState(uid, jobId)).toEqual({ gen: 0, refunds: 1 });
    } finally {
      await cleanupUsage(uid);
    }
  });
});

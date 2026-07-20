import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { acquireXactLock, xAccountLockKey } from "./locks";
import { closePool, getPool, poolStats, withTransaction } from "./pool";

/**
 * Integration tests for the DB pool + advisory lock helpers (T-M0-09):
 * transaction commit/rollback with no connection leak, and that
 * pg_advisory_xact_lock serializes same-key transactions and auto-releases on
 * transaction end. Skips when the local Supabase stack is not running.
 */
describe("pool & advisory locks", () => {
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

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("commits on success and returns a value", async (ctx) => {
    if (!available) return ctx.skip();
    const result = await withTransaction(async (c) => {
      const { rows } = await c.query<{ n: number }>("select 1::int as n");
      return rows[0].n;
    });
    expect(result).toBe(1);
  });

  it("rolls back on throw", async (ctx) => {
    if (!available) return ctx.skip();
    await expect(
      withTransaction(async (c) => {
        await c.query("create temp table t_rollback (id int)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("leaves no checked-out connections after many transactions", async (ctx) => {
    if (!available) return ctx.skip();
    for (let i = 0; i < 12; i++) {
      // mix of commits and rollbacks
      if (i % 2 === 0) {
        await withTransaction(async (c) => c.query("select 1"));
      } else {
        await withTransaction(async () => {
          throw new Error("x");
        }).catch(() => {});
      }
    }
    const stats = poolStats();
    // every connection returned to the pool; none stuck checked out or queued
    expect(stats.waiting).toBe(0);
    expect(stats.idle).toBe(stats.total);
  });

  it("serializes same-key advisory locks and auto-releases on tx end", async (ctx) => {
    if (!available) return ctx.skip();
    const pool = getPool();
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const key = xAccountLockKey("acct-serialize");
      await a.query("begin");
      await acquireXactLock(a, key);

      await b.query("begin");
      let bAcquired = false;
      const bPromise = acquireXactLock(b, key).then(() => {
        bAcquired = true;
      });

      await sleep(250);
      expect(bAcquired, "B must block while A holds the lock").toBe(false);

      await a.query("commit"); // releases A's advisory lock
      await bPromise;
      expect(bAcquired, "B proceeds once A releases").toBe(true);
      await b.query("commit");
    } finally {
      a.release();
      b.release();
    }
  });

  it("does not block on different keys", async (ctx) => {
    if (!available) return ctx.skip();
    const pool = getPool();
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await acquireXactLock(a, xAccountLockKey("acct-A"));
      await b.query("begin");
      // different key → acquires immediately (no deadlock/block)
      await acquireXactLock(b, xAccountLockKey("acct-B"));
      await a.query("commit");
      await b.query("commit");
      expect(true).toBe(true);
    } finally {
      a.release();
      b.release();
    }
  });
});

import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { runSchedulerTick, withCronWindowClaim } from "./cron";

/**
 * DB integration tests for the cron skeleton (T-M0-15, ADR-0003): the cron_runs
 * window claim (dedup marker) guarantees a given job+time-window is accepted at
 * most once — including across post-completion HTTP retries / duplicate Cron
 * invocations and after fn failure — carries no completion state, and
 * runSchedulerTick dispatches leftover queued jobs (next-window catch-up) and
 * invokes stale recovery. Skips without the local Supabase stack.
 */
describe("cron window claim & scheduler tick", () => {
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

  async function cleanupCronRuns(): Promise<void> {
    await withTransaction((c) =>
      c.query(`delete from cron_runs where window_key like 'test-%'`),
    );
  }

  it("accepts a job+window at most once (duplicate and post-completion retries skip)", async () => {
    const windowKey = `test-${randomUUID()}`;
    try {
      let calls = 0;
      const first = await withCronWindowClaim(
        "scheduler_tick",
        windowKey,
        async () => {
          calls += 1;
          return "first";
        },
      );
      expect(first.ran).toBe(true);
      expect(first.result).toBe("first");
      expect(calls).toBe(1);

      // a second run of the SAME window after completion must NOT run again
      // (guards against launchd HTTP retries / duplicate Cron invocations)
      const second = await withCronWindowClaim(
        "scheduler_tick",
        windowKey,
        async () => {
          calls += 1;
          return "second";
        },
      );
      expect(second.ran).toBe(false);
      expect(second.result).toBeUndefined();
      expect(calls).toBe(1); // fn was not invoked again

      // the same window under a different job name is independent
      const otherJob = await withCronWindowClaim(
        "news_fetch",
        windowKey,
        async () => "other",
      );
      expect(otherJob.ran).toBe(true);

      // a different window runs
      const third = await withCronWindowClaim(
        "scheduler_tick",
        `test-${randomUUID()}`,
        async () => "third",
      );
      expect(third.ran).toBe(true);
    } finally {
      await cleanupCronRuns();
    }
  });

  it("concurrent runs of the same window: exactly one wins", async () => {
    const windowKey = `test-${randomUUID()}`;
    try {
      let calls = 0;
      const run = () =>
        withCronWindowClaim("scheduler_tick", windowKey, async () => {
          calls += 1;
          return "x";
        });
      const [a, b] = await Promise.all([run(), run()]);
      expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);
      expect(calls).toBe(1);
    } finally {
      await cleanupCronRuns();
    }
  });

  it("keeps the claim after fn fails; the same window is not re-accepted", async () => {
    const windowKey = `test-${randomUUID()}`;
    try {
      await expect(
        withCronWindowClaim("scheduler_tick", windowKey, async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      // the claim row persists (dedup marker is receipt-only, not tied to success)
      const rows = await withTransaction((c) =>
        c.query<{ n: string }>(
          `select count(*)::int as n from cron_runs where job_name = 'scheduler_tick' and window_key = $1`,
          [windowKey],
        ),
      );
      expect(rows.rows[0].n).toBe(1);

      // a retry of the same window is NOT re-accepted (fn not invoked)
      let called = false;
      const retry = await withCronWindowClaim(
        "scheduler_tick",
        windowKey,
        async () => {
          called = true;
        },
      );
      expect(retry.ran).toBe(false);
      expect(called).toBe(false);
    } finally {
      await cleanupCronRuns();
    }
  });

  it("cron_runs carries no completion state (dedup marker only)", async () => {
    const cols = await withTransaction((c) =>
      c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'cron_runs'`,
      ),
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining(["id", "job_name", "window_key", "claimed_at"]),
    );
    // no completion/finished columns — completion lives in generation_jobs / business data
    expect(names).not.toContain("finished_at");
    expect(names).not.toContain("completed_at");
  });

  it("scheduler tick catch-up: dispatches leftover queued jobs (scheduled_for→created_at) and runs stale recovery", async () => {
    async function makeXid(
      c: PoolClient,
    ): Promise<{ uid: string; xid: string }> {
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
      return { uid, xid: rows[0].id };
    }

    const { uid, earlySched, lateSched, noSched, staleId } =
      await withTransaction(async (c) => {
        const { uid, xid } = await makeXid(c);
        // two schedule jobs with different scheduled_for + one manual (no schedule)
        const lateSched = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status, scheduled_for)
             values ($1, 'post_generation', 'schedule', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued', now() + interval '2 min') returning id`,
            [xid],
          )
        ).rows[0].id;
        const earlySched = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status, scheduled_for)
             values ($1, 'post_generation', 'schedule', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued', now() + interval '1 min') returning id`,
            [xid],
          )
        ).rows[0].id;
        const noSched = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status)
             values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued') returning id`,
            [xid],
          )
        ).rows[0].id;
        // a stale running job (attempt<3) to be recovered
        const staleId = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status, attempt, locked_at, locked_by, started_at)
             values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'running', 1, now() - interval '15 min', 'w', now()) returning id`,
            [xid],
          )
        ).rows[0].id;
        return { uid, earlySched, lateSched, noSched, staleId };
      });

    try {
      const dispatched: string[] = [];
      const result = await runSchedulerTick(async (id) => {
        dispatched.push(id);
        return { ok: true, status: 202 };
      });

      // our jobs dispatched in scheduled_for asc (nulls last → manual last)
      const mine = dispatched.filter((id) =>
        [earlySched, lateSched, noSched].includes(id),
      );
      expect(mine).toEqual([earlySched, lateSched, noSched]);
      expect(result.dispatched).toBeGreaterThanOrEqual(3);

      // stale job was recovered back to queued
      const rec = await withTransaction((c) =>
        c.query<{ status: string }>(
          `select status from generation_jobs where id = $1`,
          [staleId],
        ),
      );
      expect(rec.rows[0].status).toBe("queued");
    } finally {
      // auth.users → profiles → x_accounts → generation_jobs は全て on delete cascade
      // なので、auth.users を消せばこのテストが作った行をすべて掃除できる。
      await withTransaction((c) =>
        c.query(`delete from auth.users where id = $1`, [uid]),
      );
    }
  });
});

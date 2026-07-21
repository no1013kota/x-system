import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { runSchedulerTick, withCronWindowLock } from "./cron";

/**
 * DB integration tests for the cron skeleton (T-M0-15, ADR-0003): the cron_runs
 * lease guarantees a given job+time-window runs at most once — including across
 * post-completion HTTP retries / duplicate Cron invocations — and
 * runSchedulerTick dispatches leftover queued jobs in order and invokes stale
 * recovery. Skips without the local Supabase stack.
 */
describe("cron window lease & scheduler tick", () => {
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

  it("runs a job+window at most once (duplicate and post-completion retries skip)", async () => {
    const windowKey = `test-${randomUUID()}`;
    try {
      let calls = 0;
      const first = await withCronWindowLock(
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
      const second = await withCronWindowLock(
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

      // the finished_at is recorded on the successful run
      const row = await withTransaction((c) =>
        c.query<{ finished_at: string | null }>(
          `select finished_at from cron_runs where job_name = 'scheduler_tick' and window_key = $1`,
          [windowKey],
        ),
      );
      expect(row.rows[0].finished_at).not.toBeNull();

      // the same window under a different job name is independent
      const otherJob = await withCronWindowLock(
        "news_fetch",
        windowKey,
        async () => "other",
      );
      expect(otherJob.ran).toBe(true);

      // a different window runs
      const third = await withCronWindowLock(
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
        withCronWindowLock("scheduler_tick", windowKey, async () => {
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

  it("dispatches leftover queued jobs in scheduled_for→created_at order and runs stale recovery", async () => {
    async function makeXid(c: PoolClient): Promise<string> {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(`insert into profiles (id, email) values ($1, $2)`, [
        uid,
        `${uid}@example.com`,
      ]);
      const { rows } = await c.query<{ id: string }>(
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
         values ($1, $2, 'h', 'n', 'byok') returning id`,
        [uid, `x-${randomUUID()}`],
      );
      return rows[0].id;
    }

    const { xid, earlySched, lateSched, noSched, staleId } =
      await withTransaction(async (c) => {
        const xid = await makeXid(c);
        // two schedule jobs with different scheduled_for + one manual (no schedule)
        const lateSched = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, scheduled_for)
             values ($1,'post_generation','schedule','queued', now() + interval '2 min') returning id`,
            [xid],
          )
        ).rows[0].id;
        const earlySched = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, scheduled_for)
             values ($1,'post_generation','schedule','queued', now() + interval '1 min') returning id`,
            [xid],
          )
        ).rows[0].id;
        const noSched = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status)
             values ($1,'post_generation','manual','queued') returning id`,
            [xid],
          )
        ).rows[0].id;
        // a stale running job (attempt<3) to be recovered
        const staleId = (
          await c.query<{ id: string }>(
            `insert into generation_jobs (x_account_id, kind, trigger, status, attempt, locked_at, locked_by, started_at)
             values ($1,'post_generation','manual','running',1, now() - interval '15 min','w', now()) returning id`,
            [xid],
          )
        ).rows[0].id;
        return { xid, earlySched, lateSched, noSched, staleId };
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
      await withTransaction((c) =>
        c.query(`delete from x_accounts where id = $1`, [xid]),
      );
    }
  });
});

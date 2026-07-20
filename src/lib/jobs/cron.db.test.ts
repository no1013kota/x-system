import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import { runSchedulerTick, withCronWindowLock } from "./cron";

/**
 * DB integration tests for the cron skeleton (T-M0-15): the time-window advisory
 * lock prevents concurrent duplicate runs, and runSchedulerTick dispatches
 * leftover queued jobs in order and invokes stale recovery. Skips without the
 * local Supabase stack.
 */
describe("cron window lock & scheduler tick", () => {
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

  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("a second run of the same window cannot acquire the lock (skips)", async () => {
    const windowKey = `test-${randomUUID()}`;
    const gate = deferred();
    // first run holds the lock until we release the gate
    const first = withCronWindowLock("scheduler_tick", windowKey, async () => {
      await gate.promise;
      return "first";
    });
    // give the first run a moment to acquire
    await new Promise((r) => setTimeout(r, 50));
    const second = await withCronWindowLock(
      "scheduler_tick",
      windowKey,
      async () => "second",
    );
    expect(second.ran).toBe(false); // blocked by the first holder
    gate.resolve();
    const firstResult = await first;
    expect(firstResult.ran).toBe(true);
    expect(firstResult.result).toBe("first");

    // once released, the window can be acquired again
    const third = await withCronWindowLock(
      "scheduler_tick",
      windowKey,
      async () => "third",
    );
    expect(third.ran).toBe(true);
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

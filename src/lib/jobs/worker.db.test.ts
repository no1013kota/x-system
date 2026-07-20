import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withTransaction, closePool, getPool } from "../db/pool";
import { leaseJob, runJob } from "./worker";

/**
 * DB integration tests for the worker lease (T-M0-12, 要件04 §4): lease
 * transition (running/attempt+1/locked_by), FOR UPDATE SKIP LOCKED, the
 * same-account / same-user-post_publish concurrency guards, not-queued, and the
 * schedule-missed cancel. Skips without the local Supabase stack.
 */
describe("worker leaseJob / runJob", () => {
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
    client: PoolClient,
    userId?: string,
  ): Promise<{ uid: string; xid: string }> {
    const uid = userId ?? randomUUID();
    if (!userId) {
      await client.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
        [uid, `${uid}@example.com`],
      );
      await client.query(`insert into profiles (id, email) values ($1, $2)`, [
        uid,
        `${uid}@example.com`,
      ]);
    }
    const { rows } = await client.query<{ id: string }>(
      `insert into x_accounts (user_id, x_user_id, handle, name, auth_type)
       values ($1, $2, 'h', 'n', 'byok') returning id`,
      [uid, `x-${randomUUID()}`],
    );
    return { uid, xid: rows[0].id };
  }

  async function makeJob(
    client: PoolClient,
    xid: string,
    opts: {
      kind?: string;
      trigger?: string;
      status?: string;
      scheduledFor?: string | null;
    } = {},
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into generation_jobs (x_account_id, kind, trigger, status, scheduled_for)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        xid,
        opts.kind ?? "post_generation",
        opts.trigger ?? "manual",
        opts.status ?? "queued",
        opts.scheduledFor ?? null,
      ],
    );
    return rows[0].id;
  }

  it("leases a queued job: running, attempt+1, locked_by set", async () => {
    await withTransaction(async (c) => {
      const { xid } = await makeAccount(c);
      const jobId = await makeJob(c, xid);
      const result = await leaseJob(c, jobId, "worker-A");
      expect(result.outcome).toBe("leased");
      expect(result.job?.attempt).toBe(1);
      expect(result.job?.lockedBy).toBe("worker-A");
      const { rows } = await c.query<{ status: string; locked_at: Date | null }>(
        `select status, locked_at from generation_jobs where id = $1`,
        [jobId],
      );
      expect(rows[0].status).toBe("running");
      expect(rows[0].locked_at).not.toBeNull();
      throw new Error("rollback"); // don't persist
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("returns not_found for an unknown job id", async () => {
    await withTransaction(async (c) => {
      const result = await leaseJob(c, randomUUID(), "w");
      expect(result.outcome).toBe("not_found");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("skips (conflict) when another job on the same account is running", async () => {
    // persist an account with a running job + a queued job, then runJob the queued one
    const { xid, queuedId } = await withTransaction(async (c) => {
      const { xid } = await makeAccount(c);
      await makeJob(c, xid, { status: "running" });
      const queuedId = await makeJob(c, xid, { status: "queued" });
      return { xid, queuedId };
    });
    try {
      const result = await runJob(queuedId, "worker-B");
      expect(result.outcome).toBe("skipped_conflict");
      const { rows } = await withTransaction((c) =>
        c.query<{ status: string }>(
          `select status from generation_jobs where id = $1`,
          [queuedId],
        ),
      );
      expect(rows[0].status).toBe("queued"); // stays queued
    } finally {
      await withTransaction((c) =>
        c.query(`delete from x_accounts where id = $1`, [xid]),
      );
    }
  });

  it("skips (conflict) when the same user has a running post_publish", async () => {
    const { uid, xid2, queuedId } = await withTransaction(async (c) => {
      const { uid, xid } = await makeAccount(c);
      const { xid: xid2 } = await makeAccount(c, uid); // 2nd account, same user
      await makeJob(c, xid, { kind: "post_publish", status: "running" });
      const queuedId = await makeJob(c, xid2, {
        kind: "post_publish",
        status: "queued",
      });
      return { uid, xid2, queuedId };
    });
    try {
      const result = await runJob(queuedId, "worker-C");
      expect(result.outcome).toBe("skipped_conflict");
    } finally {
      await withTransaction((c) =>
        c.query(`delete from profiles where id = $1`, [uid]),
      );
    }
    void xid2;
  });

  it("returns not_queued for an already-running job", async () => {
    await withTransaction(async (c) => {
      const { xid } = await makeAccount(c);
      const jobId = await makeJob(c, xid, { status: "running" });
      const result = await leaseJob(c, jobId, "w");
      expect(result.outcome).toBe("not_queued");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("cancels a schedule-origin post_generation past scheduled_for + 10min", async () => {
    await withTransaction(async (c) => {
      const { xid } = await makeAccount(c);
      const jobId = await makeJob(c, xid, {
        trigger: "schedule",
        scheduledFor: new Date(Date.now() - 20 * 60_000).toISOString(),
      });
      const result = await leaseJob(c, jobId, "w");
      expect(result.outcome).toBe("canceled_missed");
      const { rows } = await c.query<{ status: string }>(
        `select status from generation_jobs where id = $1`,
        [jobId],
      );
      expect(rows[0].status).toBe("canceled");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("runJob drives a queued job to succeeded via the placeholder handler", async () => {
    const { xid, jobId } = await withTransaction(async (c) => {
      const { xid } = await makeAccount(c);
      const jobId = await makeJob(c, xid);
      return { xid, jobId };
    });
    try {
      const result = await runJob(jobId, "worker-D");
      expect(result.outcome).toBe("leased");
      expect(result.result).toBe("succeeded");
      const { rows } = await withTransaction((c) =>
        c.query<{ status: string; attempt: number; finished_at: Date | null }>(
          `select status, attempt, finished_at from generation_jobs where id = $1`,
          [jobId],
        ),
      );
      expect(rows[0].status).toBe("succeeded");
      expect(rows[0].attempt).toBe(1);
      expect(rows[0].finished_at).not.toBeNull();
    } finally {
      await withTransaction((c) =>
        c.query(`delete from x_accounts where id = $1`, [xid]),
      );
    }
  });
});

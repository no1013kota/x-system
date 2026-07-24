import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "./db/pool";
import type { ExecutionPrereqInput } from "./execution-prereqs";
import {
  addLearningSource,
  listLearningSources,
  removeLearningSource,
  type LearningSourceDeps,
} from "./learning-sources";
import { AppError } from "./observability/errors";
import type { Queryable } from "./x/token-refresh";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

const okPrereq: ExecutionPrereqInput = {
  plan: "md",
  subscriptionStatus: "active",
  xApiKeyStatus: "valid",
  hasActiveXAccount: true,
  textAiKeyValid: true,
  imageRequested: false,
  imageAiKeyValid: false,
  baseMdVersion: 1,
};

const deps: LearningSourceDeps = {
  runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
  gatherPrereqInputs: async () => okPrereq,
};

async function reject(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected rejection");
}

describe("learning sources (db)", () => {
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
        `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
         values ($1, $2, 'h', 'n', 'byok', 'active') returning id`,
        [uid, `x-${randomUUID()}`],
      )
    ).rows[0].id;
    await c.query(`update profiles set active_x_account_id = $1 where id = $2`, [xid, uid]);
    return { uid, xid };
  }

  async function seedSource(
    c: PoolClient,
    xid: string,
    type: string,
    url: string,
    status: string,
  ): Promise<string> {
    const removedAt = status === "removed" ? "now()" : "null";
    const { rows } = await c.query<{ id: string }>(
      `insert into learning_sources (x_account_id, type, url, status, removed_at)
       values ($1, $2::learning_source_type, $3, $4::learning_source_status, ${removedAt})
       returning id`,
      [xid, type, url, status],
    );
    return rows[0].id;
  }

  const rk = () => randomUUID();

  it("rejects the 4th ref_account and 11th ref_post with validation_error", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      await withTransaction(async (c) => {
        for (let i = 0; i < 3; i++) await seedSource(c, xid, "ref_account", `https://x.com/a${i}`, "analyzed");
        for (let i = 0; i < 10; i++) await seedSource(c, xid, "ref_post", `https://x.com/p/status/${i}`, "analyzed");
      });
      const e1 = await reject(
        addLearningSource(uid, { request_key: rk(), x_account_id: xid, type: "ref_account", url: "https://x.com/newacct" }, deps),
      );
      expect(e1.code).toBe("validation_error");
      expect(e1.details?.reason).toBe("limit_reached");
      const e2 = await reject(
        addLearningSource(uid, { request_key: rk(), x_account_id: xid, type: "ref_post", url: "https://x.com/p/status/999" }, deps),
      );
      expect(e2.code).toBe("validation_error");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("restores a removed source on re-add of the same URL (same row, back to pending)", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const url = "https://x.com/revive";
      const seeded = await withTransaction((c) => seedSource(c, xid, "ref_account", url, "removed"));
      const res = await addLearningSource(
        uid,
        { request_key: rk(), x_account_id: xid, type: "ref_account", url },
        deps,
      );
      expect(res.sourceId).toBe(seeded); // same row restored
      const sources = await listLearningSources(pooledDb, uid, xid);
      expect(sources.find((s) => s.id === seeded)?.status).toBe("pending");
      // learning_analysis job created for it
      const job = await withTransaction((c) =>
        c.query(`select 1 from generation_jobs where id = $1 and kind = 'learning_analysis'`, [res.jobId]),
      );
      expect(job.rowCount).toBe(1);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("is idempotent on request_key re-send (returns the same job)", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const key = rk();
      const url = "https://x.com/idem";
      const first = await addLearningSource(uid, { request_key: key, x_account_id: xid, type: "ref_account", url }, deps);
      const second = await addLearningSource(uid, { request_key: key, x_account_id: xid, type: "ref_account", url }, deps);
      expect(second.jobId).toBe(first.jobId);
      expect(second.deduped).toBe(true);
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("remove: analyzed→removing+md_merge job; pending→direct removed(null)", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const analyzed = await withTransaction((c) => seedSource(c, xid, "ref_account", "https://x.com/an", "analyzed"));
      const res = await removeLearningSource(uid, { request_key: rk(), x_account_id: xid, source_id: analyzed }, deps);
      expect(res.jobId).not.toBeNull();
      const state = await withTransaction((c) =>
        c.query<{ status: string }>(`select status::text as status from learning_sources where id = $1`, [analyzed]),
      );
      expect(state.rows[0].status).toBe("removing");
      const job = await withTransaction((c) =>
        c.query(`select 1 from generation_jobs where id = $1 and kind = 'md_merge'`, [res.jobId]),
      );
      expect(job.rowCount).toBe(1);

      // now a removing source exists → removing another is job_conflict (busy)
      const pending = await withTransaction((c) => seedSource(c, xid, "ref_post", "https://x.com/p/status/1", "pending"));
      const busy = await reject(
        removeLearningSource(uid, { request_key: rk(), x_account_id: xid, source_id: pending }, deps),
      );
      expect(busy.code).toBe("job_conflict");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("remove: pending source is removed directly without a job", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const pending = await withTransaction((c) => seedSource(c, xid, "ref_post", "https://x.com/p/status/7", "pending"));
      const res = await removeLearningSource(uid, { request_key: rk(), x_account_id: xid, source_id: pending }, deps);
      expect(res.jobId).toBeNull();
      const state = await withTransaction((c) =>
        c.query<{ status: string }>(`select status::text as status from learning_sources where id = $1`, [pending]),
      );
      expect(state.rows[0].status).toBe("removed");
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });

  it("surfaces prerequisite errors with details (settingsPath)", async () => {
    const { uid, xid } = await withTransaction((c) => makeAccount(c));
    try {
      const failing: LearningSourceDeps = {
        runInTx: deps.runInTx,
        gatherPrereqInputs: async () => ({ ...okPrereq, hasActiveXAccount: false }),
      };
      const err = await reject(
        addLearningSource(uid, { request_key: rk(), x_account_id: xid, type: "ref_account", url: "https://x.com/x" }, failing),
      );
      expect(err.code).toBe("x_account_required");
      expect(err.details?.settingsPath).toBeDefined();
    } finally {
      await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
    }
  });
});

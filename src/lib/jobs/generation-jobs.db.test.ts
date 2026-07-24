import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionPrereqInput } from "@/lib/execution-prereqs";

import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { X_SCOPES } from "../x/oauth";
import {
  cancelGenerationJob,
  createGenerationJob,
  getGenerationJob,
  retryGenerationJob,
  type CreateGenerationJobInput,
  type GenerationJobDeps,
} from "./generation-jobs";
import type { Queryable } from "../x/token-refresh";

/**
 * DB integration for generation-job actions (T-M3-07, 要件05 §5/§12):
 * request_key idempotency, 5-job budget, active-account match, retry(failed-only), cancel(queued-only).
 */
describe("generation-jobs actions (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const encrypt = (p: string) => encryptWithKey(p, testKey);
  const db: Queryable = {
    query: <T = unknown>(sql: string, params?: unknown[]) =>
      getPool().query(sql, params) as unknown as Promise<{
        rows: T[];
        rowCount: number | null;
      }>,
  };

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

  const okPrereq = (): ExecutionPrereqInput => ({
    plan: "standard",
    subscriptionStatus: "active",
    xApiKeyStatus: "valid",
    hasActiveXAccount: true,
    textAiKeyValid: true,
    imageRequested: false,
    imageAiKeyValid: false,
    baseMdVersion: 1,
  });

  const deps = (over: Partial<GenerationJobDeps> = {}): GenerationJobDeps => ({
    runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
    gatherPrereqInputs: async () => okPrereq(),
    quotePostEnabled: false,
    ...over,
  });

  async function seed(c: PoolClient): Promise<{ uid: string; xid: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email) values ($1,$2) on conflict (id) do nothing`,
      [uid, `${uid}@example.com`],
    );
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes, token_expires_at)
         values ($1,$2,'h','n','byok','active',$3,$3,$4, now()+interval '1 hour')
         returning id`,
        [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
      )
    ).rows[0].id;
    await c.query(`update profiles set active_x_account_id = $2 where id = $1`, [uid, xid]);
    return { uid, xid };
  }

  const cleanup = (uid: string) =>
    withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  const input = (xid: string, over: Partial<CreateGenerationJobInput> = {}): CreateGenerationJobInput =>
    ({ request_key: "tok", x_account_id: xid, pattern: "p1", image_enabled: false, ...over }) as CreateGenerationJobInput;

  it("is idempotent on request_key (same key → same job, no duplicate row)", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const first = await createGenerationJob(uid, input(xid, { request_key: "k1" }), deps());
      const second = await createGenerationJob(uid, input(xid, { request_key: "k1" }), deps());
      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.jobId).toBe(first.jobId);
      const count = (
        await db.query<{ n: number }>(`select count(*)::int as n from generation_jobs where x_account_id = $1`, [xid])
      ).rows[0].n;
      expect(count).toBe(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("rejects when 5 jobs are already queued/running", async () => {
    const { uid, xid } = await withTransaction(async (c) => {
      const s = await seed(c);
      for (let i = 0; i < 5; i++) {
        await c.query(
          `insert into generation_jobs (x_account_id, kind, trigger, pattern, status) values ($1,'post_generation','manual','p1','queued')`,
          [s.xid],
        );
      }
      return s;
    });
    try {
      await expect(
        createGenerationJob(uid, input(xid, { request_key: "k2" }), deps()),
      ).rejects.toMatchObject({ code: "job_conflict" });
    } finally {
      await cleanup(uid);
    }
  });

  it("rejects when the target account is not the active one", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      await withTransaction((c) => c.query(`update profiles set active_x_account_id = null where id = $1`, [uid]));
      await expect(
        createGenerationJob(uid, input(xid, { request_key: "k3" }), deps()),
      ).rejects.toMatchObject({ code: "job_conflict" });
    } finally {
      await cleanup(uid);
    }
  });

  it("retries a failed job into a parent-linked new job; cancel handles queued only", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const failedId = (
        await db.query<{ id: string }>(
          `insert into generation_jobs (x_account_id, kind, trigger, pattern, status) values ($1,'post_generation','manual','p1','failed') returning id`,
          [xid],
        )
      ).rows[0].id;
      const retry = await retryGenerationJob(uid, { job_id: failedId, request_key: "r1" }, deps());
      const parent = (
        await db.query<{ parent_job_id: string }>(`select parent_job_id from generation_jobs where id = $1`, [retry.jobId])
      ).rows[0];
      expect(parent.parent_job_id).toBe(failedId);

      // cancel: queued → canceled
      const cancelled = await cancelGenerationJob(db, uid, retry.jobId);
      expect(cancelled.status).toBe("canceled");
      // get: owner can read
      expect((await getGenerationJob(db, uid, retry.jobId)).status).toBe("canceled");
    } finally {
      await cleanup(uid);
    }
  });
});

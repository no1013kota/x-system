import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { withTransaction, closePool, getPool } from "../db/pool";

/**
 * worker機構（lease→handler→succeeded）の検証にはhandlerの成功だけが要る。
 * suggestion の実handlerは T-M8-91 でXタイムラインを読むようになった（tokenと実APIが要る）ため、
 * ここではモックする。業務ロジック自体は suggestion.db.test.ts が実物で検証する。
 */
vi.mock("./suggestion-server", () => ({ suggestionHandler: async () => {} }));
import { failJob, leaseJob, requeueJob, runJob } from "./worker";

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
      await client.query(
        `insert into profiles (id, email) values ($1, $2) on conflict (id) do nothing`,
        [uid, `${uid}@example.com`],
      );
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

  it("runJob drives a queued job to succeeded via a clean no-op handler", async () => {
    const { xid, jobId } = await withTransaction(async (c) => {
      const { xid } = await makeAccount(c);
      // 全kindが実handler化したため、worker機構の検証には suggestion を使う。投稿ドラフトが無ければ
      // 比較グループ不足で提案0件（LLM未呼び出し）となり、handlerはクリーンに succeeded する。
      const jobId = await makeJob(c, xid, { kind: "suggestion" });
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

  describe("failJob", () => {
    /** running のjobを1件作り、テスト後に x_accounts ごと後片付けする。 */
    async function withRunningJob(
      setup: (c: PoolClient, jobId: string) => Promise<void>,
      assert: (jobId: string) => Promise<void>,
    ): Promise<void> {
      const { xid, jobId } = await withTransaction(async (c) => {
        const { xid } = await makeAccount(c);
        const jobId = await makeJob(c, xid, { status: "running" });
        await setup(c, jobId);
        return { xid, jobId };
      });
      try {
        await assert(jobId);
      } finally {
        await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      }
    }

    async function readJob(jobId: string) {
      const { rows } = await withTransaction((c) =>
        c.query<{ status: string; error: { code?: string; message?: string; stage?: string } | null }>(
          `select status, error from generation_jobs where id = $1`,
          [jobId],
        ),
      );
      return rows[0];
    }

    it("handlerがerror未保存なら汎用の理由を残す", async () => {
      await withRunningJob(
        (c, jobId) =>
          c.query(`update generation_jobs set progress_stage = 'writing' where id = $1`, [jobId]).then(
            () => undefined,
          ),
        async (jobId) => {
          await failJob(jobId, "post_generation", new Error("boom"));
          const row = await readJob(jobId);
          expect(row.status).toBe("failed");
          expect(row.error?.code).toBe("job_failed");
          expect(row.error?.message).toBeTruthy();
          expect(row.error?.stage).toBe("writing");
          // 例外のmessageは保存しない
          expect(JSON.stringify(row.error)).not.toContain("boom");
        },
      );
    });

    it("handlerが保存済みのerrorを上書きしない", async () => {
      await withRunningJob(
        (c, jobId) =>
          c
            .query(
              `update generation_jobs set error = '{"code":"invalid_output","message":"生成結果を検証できませんでした。"}'::jsonb where id = $1`,
              [jobId],
            )
            .then(() => undefined),
        async (jobId) => {
          await failJob(jobId, "post_generation", new Error("boom"));
          const row = await readJob(jobId);
          expect(row.status).toBe("failed");
          expect(row.error?.code).toBe("invalid_output");
        },
      );
    });

    it("running以外（自己終端・差し戻し）は変更しない・二重呼び出しでも同じ", async () => {
      for (const status of ["canceled", "queued"]) {
        const { xid, jobId } = await withTransaction(async (c) => {
          const { xid } = await makeAccount(c);
          const jobId = await makeJob(c, xid, { status });
          return { xid, jobId };
        });
        try {
          await failJob(jobId, "post_generation", new Error("boom"));
          await failJob(jobId, "post_generation", new Error("boom"));
          const row = await readJob(jobId);
          expect(row.status).toBe(status);
          expect(row.error).toBeNull();
        } finally {
          await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
        }
      }
    });

    it("leaseは前attemptのerrorをクリアする", async () => {
      const { xid, jobId } = await withTransaction(async (c) => {
        const { xid } = await makeAccount(c);
        const jobId = await makeJob(c, xid, { status: "queued" });
        await c.query(`update generation_jobs set error = '{"code":"job_failed"}'::jsonb where id = $1`, [
          jobId,
        ]);
        return { xid, jobId };
      });
      try {
        await withTransaction((c) => leaseJob(c, jobId, "worker-lease"));
        const row = await readJob(jobId);
        expect(row.status).toBe("running");
        expect(row.error).toBeNull();
      } finally {
        await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      }
    });
  });

  describe("requeueJob（retryable差し戻し）", () => {
    it("running を backoff 付きで queued へ戻し、lock・stage・error を消す", async () => {
      const { xid, jobId } = await withTransaction(async (c) => {
        const { xid } = await makeAccount(c);
        const jobId = await makeJob(c, xid, { status: "running" });
        await c.query(
          `update generation_jobs
              set locked_at = now(), locked_by = 'w', progress_stage = 'writing',
                  error = '{"code":"job_failed"}'::jsonb
            where id = $1`,
          [jobId],
        );
        return { xid, jobId };
      });
      try {
        await requeueJob(jobId, 5_000);
        const { rows } = await withTransaction((c) =>
          c.query<{
            status: string;
            locked_by: string | null;
            progress_stage: string | null;
            error: unknown;
            not_yet: boolean;
          }>(
            `select status, locked_by, progress_stage::text as progress_stage, error,
                    (available_at > now()) as not_yet
               from generation_jobs where id = $1`,
            [jobId],
          ),
        );
        expect(rows[0]).toMatchObject({
          status: "queued",
          locked_by: null,
          progress_stage: null,
          error: null,
          not_yet: true,
        });
      } finally {
        await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      }
    });

    it("running 以外（handlerの自己終端）は変更しない", async () => {
      const { xid, jobId } = await withTransaction(async (c) => {
        const { xid } = await makeAccount(c);
        const jobId = await makeJob(c, xid, { status: "canceled" });
        return { xid, jobId };
      });
      try {
        await requeueJob(jobId, 5_000);
        const { rows } = await withTransaction((c) =>
          c.query<{ status: string }>(`select status from generation_jobs where id = $1`, [jobId]),
        );
        expect(rows[0].status).toBe("canceled");
      } finally {
        await withTransaction((c) => c.query(`delete from x_accounts where id = $1`, [xid]));
      }
    });
  });
});

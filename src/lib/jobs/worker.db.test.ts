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
        // 契約が有効な利用者だけ実行・起票の対象（T-M8-267。既定の incomplete では止まる）。
      `insert into profiles (id, email, subscription_status)
       values ($1, $2, 'active')
       on conflict (id) do update set subscription_status = 'active'`,
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
    // `post_generation` はパターンを必須にする（T-M8-129 U2）。実運用の enqueue も必ず持つ。
    const kind = opts.kind ?? "post_generation";
    const { rows } = await client.query<{ id: string }>(
      `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status, scheduled_for)
       values ($1, $2, $3, (select id from post_patterns where x_account_id = $1 and seed_key = $4), $5, $6) returning id`,
      [
        xid,
        kind,
        opts.trigger ?? "manual",
        kind === "post_generation" ? "p1" : null,
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

  /**
   * 契約が無効になった利用者のジョブは実行しない（T-M8-267）。
   *
   * 入口（Server Action・enqueue）のガードだけでは、**契約中にqueuedになったジョブ**が
   * 解約後に実行されるのを止められない（予約投稿・画像の子job・retry・tickの回収・stale再投入）。
   * 2026-08-23の監査で6経路の実行到達を確認したため、すべての実行が通る lease で止める。
   */
  it.each(["canceled", "incomplete", "past_due", "unpaid", "paused"])(
    "%s のジョブは lease せず、理由を残して canceled で終端する（T-M8-267）",
    async (status) => {
      await withTransaction(async (c) => {
        const { uid, xid } = await makeAccount(c);
        await c.query(
          `update profiles set subscription_status = $2::subscription_status where id = $1`,
          [uid, status],
        );
        const jobId = await makeJob(c, xid);

        const result = await leaseJob(c, jobId, "worker-A");
        expect(result.outcome).toBe("canceled_subscription");
        expect(result.job).toBeUndefined();

        const { rows } = await c.query<{ status: string; error: { code: string } | null }>(
          `select status, error from generation_jobs where id = $1`,
          [jobId],
        );
        // 黙って止めない——画面から「なぜ動かなかったか」が読める（原則1）。
        expect(rows[0].status).toBe("canceled");
        expect(rows[0].error?.code).toBe("subscription_required");
        throw new Error("rollback");
      }).catch((e) => {
        if (!(e instanceof Error) || e.message !== "rollback") throw e;
      });
    },
  );

  it.each(["active", "trialing"])("%s のジョブは通常どおり lease できる", async (status) => {
    await withTransaction(async (c) => {
      const { uid, xid } = await makeAccount(c);
      await c.query(
        `update profiles set subscription_status = $2::subscription_status where id = $1`,
        [uid, status],
      );
      const jobId = await makeJob(c, xid);
      expect((await leaseJob(c, jobId, "worker-A")).outcome).toBe("leased");
      throw new Error("rollback");
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

  /**
   * **見送った予約は必ず利用者へ届く**（T-M8-160・監査#22・原則1）。
   *
   * 以前この経路は cancel だけ行い「通知は scheduler_tick が担う」としていたが、tick の
   * `cancelExpiredJobs` は `status='queued'` しか拾わず、`notifyUnenqueuedMissed` は
   * 当該 `schedule_run_key` の job が在る窓を除外するため、**worker が canceled にした予約は
   * どちらからも永久に外れて何も届かなかった**（黙って投稿されない）。
   */
  it("見送った予約は schedule_missed 通知を作る（黙って投稿されないままにしない）", async () => {
    await withTransaction(async (c) => {
      const { uid, xid } = await makeAccount(c);
      // 通知設定（error）をONにする。両channel OFFなら通知は作らない仕様のため。
      await c.query(
        `update profiles
            set notification_config = jsonb_set(
                  coalesce(notification_config, '{}'::jsonb), '{error}',
                  '{"in_app": true, "email": false}'::jsonb, true)
          where id = $1`,
        [uid],
      );
      const { rows: slotRows } = await c.query<{ id: string }>(
        `insert into schedule_slots (x_account_id, weekdays, time_jst, mode, theme,
                                     pattern_id)
         values ($1, '{0,1,2,3,4,5,6}', '09:00', 'draft', 'ai',
                 (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'))
         returning id`,
        [xid],
      );
      const slotId = slotRows[0].id;
      const scheduledFor = new Date(Date.now() - 20 * 60_000).toISOString();
      const { rows: jobRows } = await c.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, pattern_id, status, scheduled_for, slot_id)
         values ($1, 'post_generation', 'schedule',
                 (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'),
                 'queued', $2, $3)
         returning id`,
        [xid, scheduledFor, slotId],
      );

      const result = await leaseJob(c, jobRows[0].id, "w");
      expect(result.outcome).toBe("canceled_missed");

      const { rows: notes } = await c.query<{ type: string; dedupe_key: string }>(
        `select type, dedupe_key from notifications where user_id = $1`,
        [uid],
      );
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe("error");
      expect(notes[0].dedupe_key).toContain(`slot:${slotId}:`);
      expect(notes[0].dedupe_key).toContain(":missed");

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

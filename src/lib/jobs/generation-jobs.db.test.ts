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

/** 既定パターンの `post_patterns.id` を引く（画面と同じ入口・T-M8-129 U5）。 */
  const patternId = (xid: string, seedKey = "p1") =>
    withTransaction(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `select id from post_patterns where x_account_id = $1 and seed_key = $2`,
        [xid, seedKey],
      );
      return rows[0].id;
    });

  const input = async (
    xid: string,
    over: Partial<CreateGenerationJobInput> = {},
  ): Promise<CreateGenerationJobInput> =>
    ({
      request_key: "tok",
      x_account_id: xid,
      pattern_id: await patternId(xid),
      image_enabled: false,
      ...over,
    }) as CreateGenerationJobInput;

  /*
    投稿作成画面の「モード」（T-M8-331）。**本番実装をそのまま通す**——ここが黙って
    落ちると「すぐに投稿を選んだのに下書きのまま」「予約したのに9時間ずれる」になり、
    画面からは説明できない（原則1・原則2）。
  */
  describe("post_mode（生成したあとどうするか・T-M8-331）", () => {
    /** 現行versionの自動投稿同意を入れる。 */
    const consent = (xid: string) =>
      withTransaction(async (c) => {
        const { CURRENT_AUTOMATION_CONSENT_VERSION } = await import("@/lib/legal");
        await c.query(
          `update x_accounts
              set automation_consent_version = $2, automation_consented_at = now(),
                  automation_disabled_at = null
            where id = $1`,
          [xid, CURRENT_AUTOMATION_CONSENT_VERSION],
        );
      });

    const jobInput = (jobId: string) =>
      db
        .query<{ input: Record<string, unknown> }>(
          `select input from generation_jobs where id = $1`,
          [jobId],
        )
        .then((r) => r.rows[0].input);

    it("既定（post_mode なし）は下書きで止まる", async () => {
      const { uid, xid } = await withTransaction((c) => seed(c));
      try {
        const { jobId } = await createGenerationJob(uid, await input(xid), deps());
        expect(await jobInput(jobId)).toMatchObject({ mode: "draft", scheduled_at: null });
      } finally {
        await cleanup(uid);
      }
    });

    it("すぐに投稿は自動投稿の同意が無いと受け付けない（生成を始めない）", async () => {
      const { uid, xid } = await withTransaction((c) => seed(c));
      try {
        await expect(
          createGenerationJob(uid, await input(xid, { post_mode: "now" }), deps()),
        ).rejects.toMatchObject({ code: "automation_consent_required" });
        const n = (
          await db.query<{ n: number }>(
            `select count(*)::int as n from generation_jobs where x_account_id = $1`,
            [xid],
          )
        ).rows[0].n;
        expect(n, "弾いたのにjobが残っている").toBe(0);
      } finally {
        await cleanup(uid);
      }
    });

    it("同意済みのすぐに投稿は mode=auto で作られる（生成後に投稿へ連鎖する）", async () => {
      const { uid, xid } = await withTransaction((c) => seed(c));
      try {
        await consent(xid);
        const { jobId } = await createGenerationJob(
          uid,
          await input(xid, { post_mode: "now" }),
          deps(),
        );
        expect(await jobInput(jobId)).toMatchObject({ mode: "auto", scheduled_at: null });
      } finally {
        await cleanup(uid);
      }
    });

    it("予約投稿は日本時間として解釈した UTC を持ち、投稿へは連鎖しない", async () => {
      const { uid, xid } = await withTransaction((c) => seed(c));
      try {
        await consent(xid);
        // 実行環境のTZに関係なく「JSTの日時」として保存されること（T-M8-229）。
        const jstInput = new Date(Date.now() + 3 * 3_600_000 + 9 * 3_600_000)
          .toISOString()
          .slice(0, 16);
        const { jobId } = await createGenerationJob(
          uid,
          await input(xid, { post_mode: "scheduled", scheduled_at: jstInput }),
          deps(),
        );
        const stored = await jobInput(jobId);
        expect(stored.mode, "予約なのに投稿へ連鎖している").toBe("draft");
        expect(new Date(String(stored.scheduled_at)).toISOString()).toBe(
          new Date(`${jstInput}:00+09:00`).toISOString(),
        );
      } finally {
        await cleanup(uid);
      }
    });

    it("過ぎた日時の予約は受け付けない（理由は日本語）", async () => {
      const { uid, xid } = await withTransaction((c) => seed(c));
      try {
        await consent(xid);
        const past = new Date(Date.now() - 3_600_000 + 9 * 3_600_000).toISOString().slice(0, 16);
        await expect(
          createGenerationJob(
            uid,
            await input(xid, { post_mode: "scheduled", scheduled_at: past }),
            deps(),
          ),
        ).rejects.toMatchObject({ code: "validation_error" });
      } finally {
        await cleanup(uid);
      }
    });
  });

  it("is idempotent on request_key (same key → same job, no duplicate row)", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const first = await createGenerationJob(uid, await input(xid, { request_key: "k1" }), deps());
      const second = await createGenerationJob(uid, await input(xid, { request_key: "k1" }), deps());
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
          `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status) values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'queued')`,
          [s.xid],
        );
      }
      return s;
    });
    try {
      await expect(
        createGenerationJob(uid, await input(xid, { request_key: "k2" }), deps()),
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
        createGenerationJob(uid, await input(xid, { request_key: "k3" }), deps()),
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
          `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status) values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'failed') returning id`,
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

  /**
   * `provider_raw_error` をブラウザへ返さない（F6）。
   *
   * F4/F5 で「AIが何を返して落ちたか」を保存するようにしたため、**画面へ渡す経路で
   * 落とすことが必須**になった（要件06 §5・要件01 §8）。描画側の注意ではなくクエリで守る。
   * 運営者はDBと `npm run smoke:live` で中身を見る。
   */
  it("getGenerationJob は provider_raw_error を返さない（DBには残る）", async () => {
    const { uid, xid } = await withTransaction((c) => seed(c));
    try {
      const jobId = (
        await db.query<{ id: string }>(
          `insert into generation_jobs (x_account_id, kind, trigger, pattern_id, status, error)
           values ($1, 'post_generation', 'manual', (select id from post_patterns where x_account_id = $1 and seed_key = 'p1'), 'failed', $2::jsonb) returning id`,
          [
            xid,
            JSON.stringify({
              code: "invalid_output",
              message: "生成結果を検証できませんでした。もう一度お試しください。",
              retryable: false,
              stage: "writing",
              provider_raw_error: "1回目の応答: {\"posts\":[]} ← 秘密が混じり得る生の本文",
            }),
          ],
        )
      ).rows[0].id;

      const view = await getGenerationJob(db, uid, jobId);
      const error = view.error as Record<string, unknown>;
      expect(error.code, "利用者向けのcodeは返す").toBe("invalid_output");
      expect(error.message).toBe("生成結果を検証できませんでした。もう一度お試しください。");
      expect(
        Object.keys(error),
        "provider_raw_error がブラウザへ渡ると要件01 §8 に反する",
      ).not.toContain("provider_raw_error");

      // DB側には残っていること（運営者が原因を追える経路を壊していない）。
      const stored = (
        await db.query<{ raw: string | null }>(
          `select error->>'provider_raw_error' as raw from generation_jobs where id = $1`,
          [jobId],
        )
      ).rows[0];
      expect(stored.raw).toContain("1回目の応答");
    } finally {
      await cleanup(uid);
    }
  });
});

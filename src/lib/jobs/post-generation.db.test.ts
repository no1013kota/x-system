import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { emptyUsage, type TextGen, type TextGenResult } from "../ai/types";
import { encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import type { ExecutionPrereqInput } from "../execution-prereqs";
import { X_SCOPES } from "../x/oauth";
import { createDeadline } from "./deadline";
import {
  executePostGeneration,
  PostGenerationTerminalError,
  type PostGenerationDeps,
} from "./post-generation";
import { InvalidProviderOutputError } from "../ai/pipeline";
import type { Queryable } from "../x/token-refresh";
import { failJob } from "./worker";

/**
 * DB integration for the post_generation worker core (T-M3-05, 要件04 §8):
 * happy path (draft + usage + notification), AI error field, and JSON invalid-after-repair.
 * Provider and prereqs are injected (mock). Skips without the local Supabase stack.
 */
describe("executePostGeneration (local DB)", () => {
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

  const satisfiedPrereqs = (): ExecutionPrereqInput => ({
    plan: "standard",
    subscriptionStatus: "active",
    xApiKeyStatus: "valid",
    hasActiveXAccount: true,
    textAiKeyValid: true,
    imageRequested: false,
    imageAiKeyValid: false,
    baseMdVersion: 1,
  });

  function mockProvider(text: string, texts?: string[]): TextGen {
    let i = 0;
    return {
      generate: async (): Promise<TextGenResult> => ({
        provider: "anthropic",
        requestId: `req_${i}`,
        text: texts ? texts[Math.min(i++, texts.length - 1)] : text,
        citations: [],
        usage: { ...emptyUsage(), inputTokens: 100, outputTokens: 50, providerCalls: 1 },
        stopReason: "end_turn",
      }),
    };
  }

  function deps(over: Partial<PostGenerationDeps>): PostGenerationDeps {
    return {
      db,
      jobId: "",
      runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
      resolveProvider: async () => ({
        textGen: mockProvider(""),
        provider: "anthropic",
        model: "claude-test",
      }),
      gatherPrereqInputs: async () => satisfiedPrereqs(),
      validateSource: async () => true,
      makeDeadline: () => createDeadline(180_000, () => 0),
      now: () => 0,
      ...over,
    };
  }

  async function seed(
    c: PoolClient,
    opts: { pattern?: string; input?: object } = {},
  ): Promise<{ uid: string; xid: string; jobId: string }> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, plan, subscription_status, notification_config)
       values ($1,$2,'standard','active',
               '{"draft_created":{"in_app":true,"email":false},"error":{"in_app":true,"email":false}}'::jsonb)
       on conflict (id) do update set
         plan = 'standard', subscription_status = 'active',
         notification_config = '{"draft_created":{"in_app":true,"email":false},"error":{"in_app":true,"email":false}}'::jsonb`,
      [uid, `${uid}@example.com`],
    );
    const xid = (
      await c.query<{ id: string }>(
        `insert into x_accounts
           (user_id, x_user_id, handle, name, auth_type, status,
            access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
            token_expires_at, base_md, base_md_version)
         values ($1,$2,'h','n','byok','active',$3,$3,$4, now()+interval '1 hour','ペルソナ定義',1)
         returning id`,
        [uid, `x-${randomUUID()}`, encrypt("t"), X_SCOPES],
      )
    ).rows[0].id;
    const jobId = (
      await c.query<{ id: string }>(
        `insert into generation_jobs (x_account_id, kind, trigger, pattern, input, status)
         values ($1,'post_generation','manual',$2,$3::jsonb,'running')
         returning id`,
        [xid, opts.pattern ?? "p1", JSON.stringify(opts.input ?? {})],
      )
    ).rows[0].id;
    return { uid, xid, jobId };
  }

  const cleanup = (uid: string) =>
    withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));

  it("happy path: creates a draft (thread=initial_thread, weighted_length), usage, and draft_created notification", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    try {
      const provider = mockProvider('{"posts":["最初の投稿","二番目の投稿"],"sources":["https://src"],"error":null}');
      const res = await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "claude-test" }) }),
      );
      expect(res.status).toBe("created");

      const draft = (
        await db.query<{
          thread: Array<{ text: string; weighted_length: number }>;
          initial_thread: unknown;
          pattern: string;
        }>(`select thread, initial_thread, pattern from drafts where id = $1`, [res.draftId])
      ).rows[0];
      expect(draft.pattern).toBe("p1");
      expect(draft.thread).toHaveLength(2);
      expect(draft.thread[0].text).toBe("最初の投稿");
      expect(draft.thread[0].weighted_length).toBeGreaterThan(0);
      expect(draft.initial_thread).toEqual(draft.thread); // saved identical

      const job = (
        await db.query<{ draft_id: string; usage: { estimated_cost_usd_total: number } }>(
          `select draft_id, usage from generation_jobs where id = $1`,
          [jobId],
        )
      ).rows[0];
      expect(job.draft_id).toBe(res.draftId);
      expect(job.usage.estimated_cost_usd_total).toBeGreaterThan(0);

      const notif = (
        await db.query<{ n: number; dedupe_key: string }>(
          `select count(*)::int as n, min(dedupe_key) as dedupe_key
             from notifications where user_id = $1 and type = 'draft_created'`,
          [uid],
        )
      ).rows[0];
      expect(notif.n).toBe(1);
      expect(notif.dedupe_key).toBe(`draft:${res.draftId}:created`);
    } finally {
      await cleanup(uid);
    }
  });

  async function setPremium(uid: string): Promise<void> {
    await withTransaction((c) => c.query(`update profiles set plan = 'premium' where id = $1`, [uid]));
  }
  async function genState(uid: string, jobId: string): Promise<{ gen: number; reserves: number; refunds: number }> {
    return withTransaction(async (c) => {
      const cnt = await c.query<{ n: number }>(
        `select coalesce(ai_credits_used, 0) as n from usage_counters where user_id = $1`,
        [uid],
      );
      const ev = await c.query<{ reason: string; n: number }>(
        `select reason, count(*)::int as n from usage_events
          where job_id = $1 and counter_type = 'ai_credit' group by reason`,
        [jobId],
      );
      const by = new Map(ev.rows.map((r) => [r.reason, r.n]));
      return { gen: cnt.rows[0]?.n ?? 0, reserves: by.get("reserve") ?? 0, refunds: by.get("refund") ?? 0 };
    });
  }
  const cleanupUsage = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  it("premium: reserves exactly +1 generation on success (JSON repair does not double-count)", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    await setPremium(uid);
    try {
      // first output is invalid → runTextGeneration repairs once → valid. reserve is once at start.
      const provider = mockProvider("", ["not json", '{"posts":["修復後の投稿"],"sources":[],"error":null}']);
      const res = await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
      );
      expect(res.status).toBe("created");
      const s = await genState(uid, jobId);
      // AIクレジット（T-M8-109）: 見積もり16をreserve→実費（モックは原価0→最低1）で精算。
      // 精算の部分返還は reason='refund'（settle key）で入るため refunds=1 になる。
      expect(s.gen).toBe(1);
      expect(s.reserves).toBe(1);
      expect(s.refunds).toBe(1); // settleの差分調整（16→1）
    } finally {
      await cleanupUsage(uid);
    }
  });

  it("standard/md: no reserve or counter change on success", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c)); // stays standard
    try {
      const provider = mockProvider('{"posts":["標準プランの投稿"],"sources":[],"error":null}');
      await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
      );
      const s = await genState(uid, jobId);
      expect(s.gen).toBe(0);
      expect(s.reserves).toBe(0); // BYOK never reserves
    } finally {
      await cleanupUsage(uid);
    }
  });

  it("premium: 失敗確定（failJob）で生成枠が返還される。handler単体では返還しない", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    await setPremium(uid);
    try {
      // always-invalid output → repair also invalid → InvalidProviderOutputError → terminal failure.
      const provider = mockProvider("still not json");
      await expect(
        executePostGeneration(
          deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
        ),
      ).rejects.toThrow();
      // 返還は handler ではなく runJob の failJob が失敗確定時に行う（要件03 §7.3）。
      // handler 単体では reserve が残ったままであることを確認する。
      const s = await genState(uid, jobId);
      expect(s.reserves).toBe(1);
      expect(s.refunds).toBe(0);
      expect(s.gen).toBe(16); // 見積もり16クレジットのreserveが残る（T-M8-109）
      // 失敗が確定すると全額返還される
      await failJob(jobId, "post_generation", new Error("terminal"));
      const after = await genState(uid, jobId);
      expect(after.refunds).toBe(1);
      expect(after.gen).toBe(0);
    } finally {
      await cleanupUsage(uid);
    }
  });

  it("post-generation validation: NG word in a post adds an ng_word warning to the draft (T-M3-06)", async () => {
    const { uid, xid, jobId } = await withTransaction((c) => seed(c));
    try {
      await withTransaction((c) =>
        c.query(`update x_accounts set settings = '{"ng":{"words":["絶対儲かる"]}}'::jsonb where id = $1`, [xid]),
      );
      const provider = mockProvider('{"posts":["絶対儲かる投資術"],"sources":[],"error":null}');
      const res = await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
      );
      const draft = (
        await db.query<{ thread: Array<{ warnings: string[] }> }>(
          `select thread from drafts where id = $1`,
          [res.draftId],
        )
      ).rows[0];
      expect(draft.thread[0].warnings).toContain("ng_word");
    } finally {
      await cleanup(uid);
    }
  });

  it("regeneration: sets parent_draft_id on the derived draft from job.input (T-M3-13)", async () => {
    const { uid, xid, jobId } = await withTransaction((c) => seed(c));
    try {
      const sourceId = (
        await db.query<{ id: string }>(
          `insert into drafts (x_account_id, pattern, thread, initial_thread, status)
           values ($1,'p1','[{"text":"元"}]'::jsonb,'[{"text":"元"}]'::jsonb,'draft') returning id`,
          [xid],
        )
      ).rows[0].id;
      await db.query(
        `update generation_jobs set input = $2::jsonb where id = $1`,
        [jobId, JSON.stringify({ parent_draft_id: sourceId, previous_posts: ["元"] })],
      );
      const provider = mockProvider('{"posts":["改善版"],"sources":[],"error":null}');
      const res = await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
      );
      const parent = (
        await db.query<{ parent_draft_id: string | null }>(
          `select parent_draft_id from drafts where id = $1`,
          [res.draftId],
        )
      ).rows[0];
      expect(parent.parent_draft_id).toBe(sourceId);
    } finally {
      await cleanup(uid);
    }
  });

  it("is idempotent: a second run returns already_done without a duplicate draft", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    try {
      const provider = mockProvider('{"posts":["p"],"sources":[],"error":null}');
      const d = deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) });
      const first = await executePostGeneration(d);
      const second = await executePostGeneration(d);
      expect(first.status).toBe("created");
      expect(second.status).toBe("already_done");
      expect(second.draftId).toBe(first.draftId);
      const count = (
        await db.query<{ n: number }>(`select count(*)::int as n from drafts where source_job_id = $1`, [jobId])
      ).rows[0].n;
      expect(count).toBe(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("AI error field: fails with a saved error (raw for logs) and an error notification, no draft", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    try {
      const provider = mockProvider('{"posts":[],"sources":[],"error":"生成材料が不足"}');
      await expect(
        executePostGeneration(deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) })),
      ).rejects.toBeInstanceOf(PostGenerationTerminalError);

      const job = (
        await db.query<{ error: { code: string; message: string; provider_raw_error: string } }>(
          `select error from generation_jobs where id = $1`,
          [jobId],
        )
      ).rows[0];
      expect(job.error.code).toBe("generation_error");
      expect(job.error.provider_raw_error).toBe("生成材料が不足"); // raw kept for logs
      expect(job.error.message).not.toContain("生成材料が不足"); // user-facing is safe/generic

      const drafts = (
        await db.query<{ n: number }>(`select count(*)::int as n from drafts where source_job_id = $1`, [jobId])
      ).rows[0].n;
      expect(drafts).toBe(0);
      const errNotif = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from notifications where user_id = $1 and type = 'error'`,
          [uid],
        )
      ).rows[0].n;
      expect(errNotif).toBe(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("JSON invalid after repair: fails with invalid_output, no draft", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    try {
      const provider = mockProvider("", ["これはJSONではない", "まだJSONではない"]);
      await expect(
        executePostGeneration(deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) })),
      ).rejects.toBeInstanceOf(InvalidProviderOutputError);

      const job = (
        await db.query<{ error: { code: string } | null; usage: { calls: unknown[] } }>(
          `select error, usage from generation_jobs where id = $1`,
          [jobId],
        )
      ).rows[0];
      expect(job.error?.code).toBe("invalid_output");
      expect(job.usage.calls.length).toBe(2); // initial + repair recorded
      const drafts = (
        await db.query<{ n: number }>(`select count(*)::int as n from drafts where source_job_id = $1`, [jobId])
      ).rows[0].n;
      expect(drafts).toBe(0);
    } finally {
      await cleanup(uid);
    }
  });

  it("unmet prerequisites: fails terminally with a saved error, no draft", async () => {
    const { uid, jobId } = await withTransaction((c) => seed(c));
    try {
      await expect(
        executePostGeneration(
          deps({
            jobId,
            gatherPrereqInputs: async () => ({ ...satisfiedPrereqs(), hasActiveXAccount: false }),
          }),
        ),
      ).rejects.toBeInstanceOf(PostGenerationTerminalError);
      const job = (
        await db.query<{ error: { code: string } | null }>(
          `select error from generation_jobs where id = $1`,
          [jobId],
        )
      ).rows[0];
      expect(job.error?.code).toBe("x_account_required");
    } finally {
      await cleanup(uid);
    }
  });

  /**
   * この生成にだけ使うプロンプト（T-M8-92）。
   *
   * `input.prompt_override` があれば通常の解決（アカウント上書き→system default→コード定数）を
   * 飛ばして、その本文が `<pattern>` としてLLMへ渡ること。**保存はされない**（prompt_templates に
   * 行が増えない）ことも固定する——「この生成にだけ」の約束が破られると、スケジュールの
   * 自動生成まで意図しないプロンプトで動く。
   */
  /**
   * 画像ON・override無しの既定経路で子jobが**実DBで**作れること（T-M8-93の回帰）。
   * `generation_jobs.input` は NOT NULL のため、明示的に null を渡すと制約違反になる。
   * この形はモックDBの単体テストでは映らず、smoke:live で初めて検出された。
   */
  it("画像ON・override無しでも image_generation 子jobが作られる（input制約）", async () => {
    const { uid, jobId } = await withTransaction((c) =>
      seed(c, { input: { theme: "ai", image_enabled: true } }),
    );
    try {
      const provider = mockProvider('{"posts":["投稿"],"sources":[],"error":null}');
      const res = await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
      );
      expect(res.status).toBe("created");
      const child = (
        await db.query<{ input: Record<string, unknown> }>(
          `select input from generation_jobs where parent_job_id = $1 and kind = 'image_generation'`,
          [jobId],
        )
      ).rows[0];
      expect(child).toBeTruthy();
      expect(child.input).toEqual({});
    } finally {
      await cleanup(uid);
    }
  });

  /**
   * アカウント.mdと画像プロンプトの「この生成にだけ」（T-M8-93）。
   * base_md_override が system（<base_md>）に入り保存版が使われないこと、
   * 画像ONのとき override が子jobの input へ引き継がれることを固定する。
   */
  it("base_md_override が system に入り、画像の override は子jobへ引き継がれる（T-M8-93）", async () => {
    const { uid, jobId } = await withTransaction((c) =>
      seed(c, {
        input: {
          theme: "ai",
          image_enabled: true,
          base_md_override: "# 発信定義書（アカウント.md）\n## 1. ペルソナ\n- 上書きペルソナ\n",
          image_prompt_override: "custom image prompt",
        },
      }),
    );
    try {
      let capturedSystem: string[] = [];
      const provider: TextGen = {
        generate: async (req) => {
          capturedSystem = req.system ?? [];
          return {
            provider: "anthropic",
            requestId: "req_cap2",
            text: '{"posts":["投稿"],"sources":[],"error":null}',
            citations: [],
            usage: { ...emptyUsage(), inputTokens: 100, outputTokens: 50, providerCalls: 1 },
            stopReason: "end_turn",
          };
        },
      };
      const res = await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
      );
      expect(res.status).toBe("created");
      const systemText = capturedSystem.join("\n");
      expect(systemText).toContain("上書きペルソナ");
      // 子job（image_generation）の input へ両方の override が引き継がれる。
      const child = (
        await db.query<{ input: { image_prompt_override?: string; base_md_override?: string } }>(
          `select input from generation_jobs where parent_job_id = $1 and kind = 'image_generation'`,
          [jobId],
        )
      ).rows[0];
      expect(child.input?.image_prompt_override).toBe("custom image prompt");
      expect(child.input?.base_md_override).toContain("上書きペルソナ");
    } finally {
      await cleanup(uid);
    }
  });

  it("input.prompt_override があれば、そのプロンプトで生成し保存はしない（T-M8-92）", async () => {
    const { uid, xid, jobId } = await withTransaction((c) =>
      seed(c, { input: { theme: "ai", prompt_override: "# タスク\nこの生成専用の指示。書き出しは数字。" } }),
    );
    try {
      let capturedUser = "";
      const provider: TextGen = {
        generate: async (req) => {
          capturedUser = req.user;
          return {
            provider: "anthropic",
            requestId: "req_cap",
            text: '{"posts":["投稿"],"sources":[],"error":null}',
            citations: [],
            usage: { ...emptyUsage(), inputTokens: 100, outputTokens: 50, providerCalls: 1 },
            stopReason: "end_turn",
          };
        },
      };
      const res = await executePostGeneration(
        deps({ jobId, resolveProvider: async () => ({ textGen: provider, provider: "anthropic", model: "m" }) }),
      );
      expect(res.status).toBe("created");
      // override がそのまま <pattern> に入り、既定テンプレ（PT_P1 の書き出し）は使われない。
      expect(capturedUser).toContain("この生成専用の指示");
      expect(capturedUser).not.toContain("ニュースを解説するスレッド");
      // 保存されない（prompt_templates にアカウント上書き行が増えない）。
      const saved = await db.query(`select 1 from prompt_templates where x_account_id = $1`, [xid]);
      expect(saved.rowCount ?? 0).toBe(0);
    } finally {
      await cleanup(uid);
    }
  });
});

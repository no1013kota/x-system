import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { emptyUsage, type TextGen } from "../ai/types";
import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { executeSuggestion } from "./suggestion";
import type { SuggestionInput } from "./suggestion-input";
import { failJob } from "./worker";

/**
 * DB integration for suggestion worker (SUGGEST, T-M8-91). fetchPosts/AI は注入し、improvement_suggestions
 * 保存（evidence.format=2・advice・post_count）・投稿0件時0件・X取得失敗時のerror保存・
 * premium reserve/refund（usage_events）を検証する。
 */
const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

function gen(body: string): TextGen {
  return {
    generate: async () => ({
      provider: "anthropic",
      requestId: "r",
      text: body,
      citations: [],
      usage: emptyUsage(),
      stopReason: "end_turn",
    }),
  };
}

/** system に何が渡ったかを捕捉する TextGen（前回レポート参照の検証用・T-M8-98）。 */
function genCapture(body: string, captured: { system: string[] }): TextGen {
  return {
    generate: async (request) => {
      captured.system = [...((request as { system?: string[] }).system ?? [])];
      return {
        provider: "anthropic",
        requestId: "r",
        text: body,
        citations: [],
        usage: emptyUsage(),
        stopReason: "end_turn",
      };
    },
  };
}

/** タイムラインの1投稿（新形式の入力）。 */
function post(id: string, impressions: number, pattern: string | null = null): SuggestionInput["posts"][number] {
  return {
    id,
    text: `本文 ${id}`,
    posted_at_jst: "2026-07-18 12:00",
    impressions,
    likes: 5,
    reposts: 1,
    replies: 0,
    has_image: false,
    has_url: false,
    pattern,
    theme: pattern ? "ai" : null,
  };
}

function deps(jobId: string, body: string, posts: SuggestionInput["posts"]) {
  return {
    db: pooledDb,
    jobId,
    runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => withTransaction((c) => fn(c as unknown as Queryable)),
    resolveProvider: async () => ({ textGen: gen(body), provider: "anthropic" as const, model: "m" }),
    fetchPosts: async () => ({ posts }),
    recordStage: async () => {},
    makeDeadline: () => ({ remainingMs: () => 90_000, canStartCall: () => true, callTimeoutMs: () => 90_000 }),
    now: () => Date.UTC(2026, 6, 20, 6, 0, 0),
  };
}

describe("suggestion worker (local DB)", () => {
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

  async function seed(plan: string): Promise<{ uid: string; xid: string; jobId: string }> {
    return withTransaction(async (c: PoolClient) => {
      const uid = randomUUID();
      await c.query(
        `insert into auth.users (id, instance_id, aud, role, email)
         values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2)`,
        [uid, `${uid}@example.com`],
      );
      await c.query(
        `insert into profiles (id, email, plan) values ($1,$2,$3::plan_type)
         on conflict (id) do update set plan = excluded.plan`,
        [uid, `${uid}@example.com`, plan],
      );
      const xid = (
        await c.query<{ id: string }>(
          `insert into x_accounts (user_id, x_user_id, handle, name, auth_type, status)
           values ($1,$2,'h','n','byok','active') returning id`,
          [uid, `x-${randomUUID()}`],
        )
      ).rows[0].id;
      const jobId = (
        await c.query<{ id: string }>(
          `insert into generation_jobs (x_account_id, kind, trigger, status)
           values ($1,'suggestion','manual','running') returning id`,
          [xid],
        )
      ).rows[0].id;
      return { uid, xid, jobId };
    });
  }

  const cleanup = async (uid: string) => {
    await withTransaction((c) => c.query(`delete from usage_events where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from usage_counters where user_id = $1`, [uid]));
    await withTransaction((c) => c.query(`delete from auth.users where id = $1`, [uid]));
  };

  async function suggestions(xid: string): Promise<{ content: string; evidence: Record<string, unknown> }[]> {
    return (
      await pooledDb.query<{ content: string; evidence: Record<string, unknown> }>(
        `select content, evidence from improvement_suggestions where x_account_id = $1 order by created_at`,
        [xid],
      )
    ).rows;
  }

  async function hasEvent(jobId: string, suffix: string): Promise<boolean> {
    const r = await pooledDb.query(`select 1 from usage_events where idempotency_key = $1`, [
      `job:${jobId}:generation:${suffix}`,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  /** PT-SUGGEST の正しい出力（新形式・T-M8-91）。good_posts.id は <posts> のIDを指す。 */
  const VALID = (id: string) =>
    JSON.stringify({
      summary: "朝に投稿したノウハウ系の表示回数が突出していた",
      good_posts: [{ id, why: `表示回数が最多（${id}）` }],
      advice: {
        pattern: { recommended: "p3", reason: "ノウハウ形式が伸びている" },
        theme: { recommended: "ai", reason: "AI関連の題材が反応を得ている" },
        image: { recommended: true, reason: "画像付きが上回った" },
        prompt: { kind: "p3", content: "# タスク\n読者が今日から実践できるノウハウを書く。書き出しは数字で始める。" },
      },
    });

  it("1件の提案を format=2・advice・post_count 付きで保存する", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      const posts = [post("t1", 100, "p3"), post("t2", 300), post("t3", 200)];
      const res = await executeSuggestion(deps(jobId, VALID("t2"), posts));
      expect(res).toMatchObject({ status: "saved", count: 1 });
      const rows = await suggestions(xid);
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toContain("表示回数が突出");
      expect(rows[0].evidence.format).toBe(2);
      expect(rows[0].evidence.post_count).toBe(3); // code-added
      expect(rows[0].evidence.analyze_limit).toBe(300); // code-added（分析上限のsnapshot）
      expect(rows[0].evidence.previous_id).toBeNull(); // 初回＝前回レポートなし（T-M8-98）
      const advice = rows[0].evidence.advice as Record<string, Record<string, unknown>>;
      expect(advice.pattern.recommended).toBe("p3");
      expect(advice.prompt.kind).toBe("p3");
      expect(String(advice.prompt.content)).toContain("# タスク");
      expect(await hasEvent(jobId, "reserve")).toBe(false); // BYOK/md → no reserve
    } finally {
      await cleanup(uid);
    }
  });

  it("アカウント.mdがあれば<account_md>としてプロンプトへ渡り、編集提案がevidenceへ残る（T-M8-106）", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      const currentMd = [
        "# 発信定義書（アカウント.md）",
        "## 1. ペルソナ",
        "現行の中身",
        "## 2. 発信テーマ",
        "## 3. トンマナ",
        "## 4. NG",
        "## 5. 学習",
        "## 6. その他",
      ].join("\n");
      await withTransaction((c) =>
        c.query(`update x_accounts set base_md = $2, base_md_version = 1 where id = $1`, [xid, currentMd]),
      );
      const proposedMd = currentMd.replace("現行の中身", "観察された強みを反映した中身");
      const body = JSON.stringify({
        summary: "総評",
        good_posts: [{ id: "t1", why: "最多" }],
        advice: {
          account_md: { content: proposedMd, reason: "ペルソナへ実績の強みを反映" },
          pattern: { recommended: "p3", reason: "r" },
          theme: { recommended: "ai", reason: "r" },
          image: { recommended: false, reason: "r" },
          prompt: { kind: "p3", content: "# タスク\n提案" },
        },
      });
      const captured = { system: [] as string[] };
      const d = deps(jobId, body, [post("t1", 100)]);
      d.resolveProvider = async () => ({
        textGen: genCapture(body, captured),
        provider: "anthropic" as const,
        model: "m",
      });
      const res = await executeSuggestion(d);
      expect(res).toMatchObject({ status: "saved", count: 1 });

      // 現行mdがプロンプトへ渡っている（未作成なら "none"）。
      const system = captured.system.join("\n");
      expect(system).toContain("現行の中身");
      expect(system).not.toContain("<account_md>none</account_md>");

      const rows = await suggestions(xid);
      const advice = rows[0].evidence.advice as Record<string, Record<string, unknown>>;
      expect(advice.account_md.reason).toBe("ペルソナへ実績の強みを反映");
      expect(String(advice.account_md.content)).toContain("観察された強みを反映した中身");
    } finally {
      await cleanup(uid);
    }
  });

  it("前回のレポート（format=2）がプロンプトへ渡り、evidence.previous_id に残る（T-M8-98）", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      // 前回のレポートを直接seedする（旧形式=format無しの行は対象外であることも同時に確認する）。
      const prevId = await withTransaction(async (c) => {
        await c.query(
          `with job as (
             insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
             values ($1,'suggestion','manual','succeeded',now()) returning id
           )
           insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
           select $1, job.id, '旧形式の提案', '{"axis":"legacy"}'::jsonb from job`,
          [xid],
        );
        return (
          await c.query<{ id: string }>(
            `with job as (
               insert into generation_jobs (x_account_id, kind, trigger, status, finished_at)
               values ($1,'suggestion','manual','succeeded',now()) returning id
             )
             insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
             select $1, job.id, '前回の総評テキスト', $2::jsonb from job returning id`,
            [
              xid,
              JSON.stringify({
                format: 2,
                good_posts: [{ id: "t9", why: "前回の根拠" }],
                advice: {
                  pattern: { recommended: "p1", reason: "前回の理由" },
                  theme: { recommended: "ai", reason: "前回の理由" },
                  image: { recommended: false, reason: "前回の理由" },
                  prompt: { kind: "p1", content: "# タスク\n前回のプロンプト全文" },
                },
                post_count: 5,
              }),
            ],
          )
        ).rows[0].id;
      });

      const captured = { system: [] as string[] };
      const posts = [post("t1", 100), post("t2", 300)];
      const d = deps(jobId, VALID("t2"), posts);
      d.resolveProvider = async () => ({
        textGen: genCapture(VALID("t2"), captured),
        provider: "anthropic" as const,
        model: "m",
      });
      const res = await executeSuggestion(d);
      expect(res).toMatchObject({ status: "saved", count: 1 });

      // <previous> に前回の総評・推奨・プロンプト全文が入っている（"none" ではない）。
      const system = captured.system.join("\n");
      expect(system).toContain("前回の総評テキスト");
      expect(system).toContain("前回のプロンプト全文");
      expect(system).not.toContain("<previous>none</previous>");
      // 「前回以降の新規投稿数」はコードで数えて渡す（LLMの日付比較は誤認する・T-M8-98）。
      // 前回=now()・投稿=2026-07-18 なので 0 件。
      expect(system).toContain('"new_posts_since_previous":0');

      const rows = await suggestions(xid);
      const latest = rows[rows.length - 1];
      expect(latest.evidence.previous_id).toBe(prevId);
    } finally {
      await cleanup(uid);
    }
  });

  it("投稿が1件も無ければLLMを呼ばず提案0件で正常終了する", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      const res = await executeSuggestion(deps(jobId, VALID("t1"), []));
      expect(res).toMatchObject({ status: "no_suggestions", count: 0 });
      expect(await suggestions(xid)).toHaveLength(0);
      expect(await hasEvent(jobId, "reserve")).toBe(false);
    } finally {
      await cleanup(uid);
    }
  });

  it("投稿が1件だけでもLLMを呼んで提案を作る（実績3件の下限は廃止・T-M8-91）", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      const res = await executeSuggestion(deps(jobId, VALID("t1"), [post("t1", 100)]));
      expect(res).toMatchObject({ status: "saved", count: 1 });
      expect(await suggestions(xid)).toHaveLength(1);
    } finally {
      await cleanup(uid);
    }
  });

  it("premiumでも生成枠を消費しない（毎朝の自動実行のため・T-M8-94）", async () => {
    // 手動起点だったころは生成枠+1をreserveしていた。自動実行では利用者の操作なしに
    // 枠が減る（毎日=月31消費）ことになるため消費しない。費用は原価台帳が記録する。
    const { uid, xid, jobId } = await seed("premium");
    try {
      const posts = [post("t1", 100), post("t2", 300), post("t3", 200)];
      await executeSuggestion(deps(jobId, VALID("t2"), posts));
      expect(await suggestions(xid)).toHaveLength(1);
      expect(await hasEvent(jobId, "reserve")).toBe(false);
    } finally {
      await cleanup(uid);
    }
  });

  it("good_posts.id が <posts> に無ければ拒否する", async () => {
    const { uid, xid, jobId } = await seed("premium");
    try {
      const posts = [post("t1", 100), post("t2", 300), post("t3", 200)];
      // <posts> に無いidを返す → refine 失敗 → 修復1回（同じ応答）→ InvalidProviderOutputError
      await expect(executeSuggestion(deps(jobId, VALID("not-a-real-id"), posts))).rejects.toThrow();
      expect(await suggestions(xid)).toHaveLength(0);
      // 枠を予約していないので、失敗確定（failJob）でも返還は発生しない（冪等に何も起きない）。
      await failJob(jobId, "suggestion", new Error("terminal"));
      expect(await hasEvent(jobId, "reserve")).toBe(false);
      expect(await hasEvent(jobId, "refund")).toBe(false);
    } finally {
      await cleanup(uid);
    }
  });

  it("X取得が失敗したら理由を保存して落ちる（静かに0件にしない・原則1）", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      const failing = {
        ...deps(jobId, VALID("t1"), []),
        fetchPosts: async () => {
          throw new Error("boom: X API 429");
        },
      };
      await expect(executeSuggestion(failing)).rejects.toThrow();
      const { rows } = await pooledDb.query<{ error: Record<string, unknown> }>(
        `select error from generation_jobs where id = $1`,
        [jobId],
      );
      expect(rows[0].error.code).toBe("x_fetch_failed");
      expect(rows[0].error.stage).toBe("research");
      expect(String(rows[0].error.message)).toContain("Xから投稿を取得できませんでした");
      expect(await suggestions(xid)).toHaveLength(0);
      expect(await hasEvent(jobId, "reserve")).toBe(false); // 取得前なので枠は消費しない
    } finally {
      await cleanup(uid);
    }
  });

  /**
   * 失敗時に保存される `error` JSON の**キー集合**を固定する（R23の特性テスト・F5で更新）。
   * refine 失敗（`<posts>` に無いIDを返した等）の中身は運営者が最も知りたい情報で、
   * これが無いと `suggestion_failed` だけが残って原因を追えない（CLAUDE.md 原則2）。
   */
  it("失敗時の error JSON は5キーで、AIが何を返したかが残る", async () => {
    const { uid, xid, jobId } = await seed("premium");
    try {
      const posts = [post("t1", 100), post("t2", 300), post("t3", 200)];
      await expect(executeSuggestion(deps(jobId, VALID("not-a-real-id"), posts))).rejects.toThrow();
      const { rows } = await pooledDb.query<{ error: Record<string, unknown> }>(
        `select error from generation_jobs where id = $1`,
        [jobId],
      );
      expect(Object.keys(rows[0].error).sort()).toEqual([
        "code",
        "message",
        "provider_raw_error",
        "retryable",
        "stage",
      ]);
      expect(rows[0].error.message).toBe("投稿分析に失敗しました。");
      expect(rows[0].error.stage).toBe("writing");
      expect(rows[0].error.retryable).toBe(false);
      // 検証に落ちた本文が実際に入る（空やnullでは原因を追えない）。
      const raw = String(rows[0].error.provider_raw_error ?? "");
      expect(raw).toContain("InvalidProviderOutputError");
      expect(raw, "providerの応答本文が残る").toContain("not-a-real-id");
      expect(xid).toBeTruthy();
    } finally {
      await cleanup(uid);
    }
  });
});

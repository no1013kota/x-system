import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { emptyUsage, type TextGen } from "../ai/types";
import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { executeSuggestion } from "./suggestion";
import type { SuggestionInputDraft } from "./suggestion-input";
import { failJob } from "./worker";

/**
 * DB integration for suggestion worker (SUGGEST, T-M5-18). fetchDrafts/AI は注入し、improvement_suggestions
 * 保存・window_days=30・比較グループ不足時0件・premium reserve/refund（usage_events）を検証する。
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

function deps(jobId: string, body: string, drafts: SuggestionInputDraft[]) {
  return {
    db: pooledDb,
    jobId,
    runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => withTransaction((c) => fn(c as unknown as Queryable)),
    resolveProvider: async () => ({ textGen: gen(body), provider: "anthropic" as const, model: "m" }),
    fetchDrafts: async () => drafts,
    recordStage: async () => {},
    makeDeadline: () => ({ remainingMs: () => 90_000, canStartCall: () => true, callTimeoutMs: () => 90_000 }),
    now: () => Date.UTC(2026, 6, 20, 6, 0, 0),
  };
}

/** postedな1-tweetドラフト（7日checkpoint impressions付き）。 */
function draft(tweetId: string, impressions: number): SuggestionInputDraft {
  return {
    pattern: "p1",
    postedAt: "2026-07-18T03:00:00.000Z",
    thread: [{ text: `本文 ${tweetId}` }],
    tweet_ids: [tweetId],
    status: "posted",
    last_post_error: null,
    tweet_metrics: { [tweetId]: { checkpoints: { "7": { impressions } } } },
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

  const VALID = (id: string) =>
    JSON.stringify({
      suggestions: [
        {
          content: "朝の時間帯に投稿頻度を上げる",
          evidence: { axis: "length", tweet_ids: [id], metric: "impressions", checkpoint_days: 7, diff_pct: 40, summary: "根拠" },
        },
      ],
    });

  it("saves suggestions with window_days=30 and source_job_id (md plan, no reserve)", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      const drafts = [draft("t1", 100), draft("t2", 300), draft("t3", 200)];
      const res = await executeSuggestion(deps(jobId, VALID("t1"), drafts));
      expect(res).toMatchObject({ status: "saved", count: 1 });
      const rows = await suggestions(xid);
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toContain("朝の時間帯");
      expect(rows[0].evidence.window_days).toBe(30); // code-added
      expect(rows[0].evidence.checkpoint_days).toBe(7);
      expect(await hasEvent(jobId, "reserve")).toBe(false); // BYOK/md → no reserve
    } finally {
      await cleanup(uid);
    }
  });

  it("returns 0 suggestions without calling the LLM when fewer than 3 comparable posts", async () => {
    const { uid, xid, jobId } = await seed("md");
    try {
      const res = await executeSuggestion(deps(jobId, VALID("t1"), [draft("t1", 100), draft("t2", 200)]));
      expect(res).toMatchObject({ status: "no_suggestions", count: 0 });
      expect(await suggestions(xid)).toHaveLength(0);
      expect(await hasEvent(jobId, "reserve")).toBe(false);
    } finally {
      await cleanup(uid);
    }
  });

  it("premium: reserves on LLM run and keeps it on success", async () => {
    const { uid, xid, jobId } = await seed("premium");
    try {
      const drafts = [draft("t1", 100), draft("t2", 300), draft("t3", 200)];
      await executeSuggestion(deps(jobId, VALID("t2"), drafts));
      expect(await suggestions(xid)).toHaveLength(1);
      expect(await hasEvent(jobId, "reserve")).toBe(true);
      expect(await hasEvent(jobId, "refund")).toBe(false); // success keeps the reserve
    } finally {
      await cleanup(uid);
    }
  });

  it("rejects evidence.tweet_ids not in <posts>。返還は失敗確定（failJob）で行う", async () => {
    const { uid, xid, jobId } = await seed("premium");
    try {
      const drafts = [draft("t1", 100), draft("t2", 300), draft("t3", 200)];
      // returns an id not present in <posts> → refine fails → repair (same) → InvalidProviderOutputError
      await expect(executeSuggestion(deps(jobId, VALID("not-a-real-id"), drafts))).rejects.toThrow();
      expect(await suggestions(xid)).toHaveLength(0);
      expect(await hasEvent(jobId, "reserve")).toBe(true);
      expect(await hasEvent(jobId, "refund")).toBe(false); // handlerは返還しない
      await failJob(jobId, "suggestion", new Error("terminal"));
      expect(await hasEvent(jobId, "refund")).toBe(true); // 失敗確定で返還
    } finally {
      await cleanup(uid);
    }
  });
});

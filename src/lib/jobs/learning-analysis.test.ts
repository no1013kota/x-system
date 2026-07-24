import { describe, expect, it, vi } from "vitest";

import { emptyUsage, type TextGen } from "../ai/types";
import type { Queryable } from "../x/token-refresh";
import {
  executeLearningAnalysis,
  LearningAnalysisTerminalError,
  type LearningAnalysisDeps,
} from "./learning-analysis";

const LOAD_JOB = /select gj\.learning_source_id/;
const LOAD_SOURCE = /select type::text as type, url, status::text as status from learning_sources/;
const RESERVE = /insert into usage_events[\s\S]*'reserve'/;
const REFUND = /insert into usage_events[\s\S]*'refund'/;
const SAVE_ANALYSIS = /update learning_sources[\s\S]*analysis_summary/;
const SOURCE_FAILED = /update learning_sources set status = 'failed'/;
const NOTIF = /insert into notifications/;

type Handler = (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number };

function mockDb(handler: Handler) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const r = handler(sql, params);
      const rows = (r.rows ?? []) as T[];
      return { rows, rowCount: r.rowCount ?? rows.length };
    },
  };
  return { db, writes };
}

function textGen(responses: string[]): TextGen {
  let i = 0;
  return {
    generate: async () => ({
      provider: "anthropic",
      requestId: "r",
      text: responses[Math.min(i++, responses.length - 1)],
      citations: [],
      usage: emptyUsage(),
      stopReason: "end_turn",
    }),
  };
}

const L1 = JSON.stringify({ style: "s", structure: "st", topics: "t", takeaway: "tk" });
const L2 = JSON.stringify({ why: "w", pattern: "p", caution: "c" });
const L3 = JSON.stringify({
  vocabulary: "v",
  tone: "to",
  perspective: "pe",
  signature: "si",
  examples: "ex",
});

function deps(
  over: Partial<LearningAnalysisDeps> & { db: Queryable },
): LearningAnalysisDeps {
  return {
    jobId: "job1",
    runInTx: (fn) => fn(over.db),
    resolveProvider: async () => ({ textGen: textGen([L1]), provider: "anthropic", model: "m" }),
    fetchReferenceAccountPosts: async () => ["a", "b"],
    fetchReferencePost: async () => ({ text: "post", metrics: { like_count: 9 } }),
    fetchOwnPosts: async () => ["x", "y"],
    recordStage: async () => {},
    now: () => 0,
    makeDeadline: () => ({ remainingMs: () => 90_000, canStartCall: () => true, callTimeoutMs: () => 90_000 }),
    ...over,
  };
}

function jobHandler(opts: { type: string; url: string; status: string; plan: string }): Handler {
  return (sql) => {
    if (LOAD_JOB.test(sql))
      return { rows: [{ learning_source_id: "s1", x_account_id: "xa1", user_id: "u1", plan: opts.plan }] };
    if (LOAD_SOURCE.test(sql)) return { rows: [{ type: opts.type, url: opts.url, status: opts.status }] };
    if (RESERVE.test(sql)) return { rowCount: 1 };
    if (REFUND.test(sql)) return { rows: [{ user_id: "u1", month: "2026-07", counter_type: "generation" }] };
    return { rows: [] };
  };
}

describe("executeLearningAnalysis", () => {
  it("analyzes a ref_account (PT-L1) and saves analysis_summary + analyzed (BYOK: no reserve)", async () => {
    const { db, writes } = mockDb(jobHandler({ type: "ref_account", url: "https://x.com/foo", status: "pending", plan: "md" }));
    const res = await executeLearningAnalysis(
      deps({ db, resolveProvider: async () => ({ textGen: textGen([L1]), provider: "anthropic", model: "m" }) }),
    );
    expect(res).toEqual({ status: "analyzed", sourceId: "s1" });
    const saved = writes.find((w) => SAVE_ANALYSIS.test(w.sql))!;
    expect(JSON.parse(saved.params[1] as string)).toMatchObject({ type: "ref_account", style: "s" });
    expect(writes.some((w) => RESERVE.test(w.sql))).toBe(false); // BYOK
  });

  it("analyzes a ref_post (PT-L2) using the injected text+metrics", async () => {
    const fetchReferencePost = vi.fn(async () => ({ text: "hot post", metrics: { like_count: 99 } }));
    const gen = textGen([L2]);
    const captured: string[] = [];
    const spyGen: TextGen = { generate: async (req) => { captured.push(req.user); return gen.generate(req); } };
    const { db, writes } = mockDb(jobHandler({ type: "ref_post", url: "https://x.com/foo/status/12", status: "pending", plan: "md" }));
    const res = await executeLearningAnalysis(
      deps({ db, fetchReferencePost, resolveProvider: async () => ({ textGen: spyGen, provider: "anthropic", model: "m" }) }),
    );
    expect(res.status).toBe("analyzed");
    expect(fetchReferencePost).toHaveBeenCalledWith({ tweetId: "12" });
    expect(captured[0]).toContain("<post>");
    expect(captured[0]).toContain("<metrics>");
    expect(JSON.parse(writes.find((w) => SAVE_ANALYSIS.test(w.sql))!.params[1] as string).why).toBe("w");
  });

  it("analyzes own_posts (PT-L3)", async () => {
    const { db, writes } = mockDb(jobHandler({ type: "own_posts", url: null as unknown as string, status: "pending", plan: "md" }));
    const res = await executeLearningAnalysis(
      deps({ db, resolveProvider: async () => ({ textGen: textGen([L3]), provider: "anthropic", model: "m" }) }),
    );
    expect(res.status).toBe("analyzed");
    expect(JSON.parse(writes.find((w) => SAVE_ANALYSIS.test(w.sql))!.params[1] as string).vocabulary).toBe("v");
  });

  it("reserves a generation for premium at start", async () => {
    const { db, writes } = mockDb(jobHandler({ type: "ref_account", url: "https://x.com/foo", status: "pending", plan: "premium" }));
    await executeLearningAnalysis(deps({ db }));
    const reserve = writes.find((w) => RESERVE.test(w.sql))!;
    expect(reserve.params[5]).toBe("job:job1:generation:reserve"); // idempotency key
  });

  it("skips re-analysis when the source is already analyzed", async () => {
    const { db } = mockDb(jobHandler({ type: "ref_account", url: "https://x.com/foo", status: "analyzed", plan: "premium" }));
    const res = await executeLearningAnalysis(deps({ db }));
    expect(res.status).toBe("already_done");
  });

  it("on invalid output (after repair) marks source failed, notifies, and refunds premium", async () => {
    const { db, writes } = mockDb(jobHandler({ type: "ref_account", url: "https://x.com/foo", status: "pending", plan: "premium" }));
    await expect(
      executeLearningAnalysis(
        deps({ db, resolveProvider: async () => ({ textGen: textGen(["not json", "still not json"]), provider: "anthropic", model: "m" }) }),
      ),
    ).rejects.toBeInstanceOf(LearningAnalysisTerminalError);
    expect(writes.some((w) => SOURCE_FAILED.test(w.sql))).toBe(true);
    expect(writes.find((w) => NOTIF.test(w.sql))?.params[1]).toBe("job:job1:failed");
    expect(writes.some((w) => REFUND.test(w.sql))).toBe(true); // premium refund
  });
});

const REQUEUE = /update generation_jobs\s+set status = 'queued'/;
const SELECT_ATTEMPT = /select attempt from generation_jobs/;

class RetryableErr extends Error {
  readonly retryable = true;
  constructor() {
    super("transient");
    this.name = "RetryableErr";
  }
}

describe("executeLearningAnalysis — retryable handling (T-M5-04 fix)", () => {
  function retryHandler(attempt: number): Handler {
    return (sql) => {
      if (LOAD_JOB.test(sql))
        return { rows: [{ learning_source_id: "s1", x_account_id: "xa1", user_id: "u1", plan: "premium" }] };
      if (LOAD_SOURCE.test(sql)) return { rows: [{ type: "ref_account", url: "https://x.com/foo", status: "pending" }] };
      if (RESERVE.test(sql)) return { rowCount: 1 };
      if (SELECT_ATTEMPT.test(sql)) return { rows: [{ attempt }] };
      if (REFUND.test(sql)) return { rows: [{ user_id: "u1", month: "2026-07", counter_type: "generation" }] };
      return { rows: [] };
    };
  }

  it("requeues (not fail/refund) on a retryable merge error while attempt < 3", async () => {
    const { db, writes } = mockDb(retryHandler(1));
    await expect(
      executeLearningAnalysis(
        deps({
          db,
          mergeAfterAnalysis: async () => {
            throw new RetryableErr();
          },
        }),
      ),
    ).rejects.toBeInstanceOf(RetryableErr);
    expect(writes.some((w) => REQUEUE.test(w.sql))).toBe(true); // self-terminated to queued
    expect(writes.some((w) => SOURCE_FAILED.test(w.sql))).toBe(false);
    expect(writes.some((w) => REFUND.test(w.sql))).toBe(false); // reserve kept for retry
  });

  it("treats a retryable error as terminal (refund + failed) once attempt >= 3", async () => {
    const { db, writes } = mockDb(retryHandler(3));
    await expect(
      executeLearningAnalysis(
        deps({
          db,
          mergeAfterAnalysis: async () => {
            throw new RetryableErr();
          },
        }),
      ),
    ).rejects.toBeInstanceOf(LearningAnalysisTerminalError); // wrapped as terminal at the cap
    expect(writes.some((w) => REQUEUE.test(w.sql))).toBe(false);
    expect(writes.some((w) => SOURCE_FAILED.test(w.sql))).toBe(true);
    expect(writes.some((w) => REFUND.test(w.sql))).toBe(true); // premium refunded at cap
  });
});

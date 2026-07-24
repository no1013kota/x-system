import { describe, expect, it } from "vitest";

import type { ProviderCall } from "../ai/normalize";
import type { Queryable } from "../x/token-refresh";
import { providerCallToUsageEvent, recordProviderCalls } from "./api-usage-ledger";

/**
 * recordProviderCalls / providerCallToUsageEvent の unit（T-M6-09, 要件02 §3.17）。冪等key採番、
 * 失敗callのstatus/error_code保持、実行時単価snapshot（算出不能はnull）、本文/prompt/秘密値の非保存を検証する。
 */

// recordExternalApiUsage の insert params 位置。
const P_STATUS = 6;
const P_ERROR_CODE = 8;
const P_USAGE_JSON = 10;
const P_UNIT_COST = 11;
const P_ESTIMATED_COST = 12;
const P_IDEMPOTENCY = 13;

function makeDb() {
  const inserts: unknown[][] = [];
  const db: Queryable = {
    query: async <T = unknown>(_sql: string, params: unknown[] = []) => {
      inserts.push(params);
      return { rows: [] as T[], rowCount: 1 };
    },
  };
  return { db, inserts };
}

function call(over: Partial<ProviderCall> = {}): ProviderCall {
  return {
    provider: "anthropic",
    model: "claude",
    operation: "text_generation",
    request_id: "req_1",
    status: "succeeded",
    stop_reason: "end_turn",
    latency_ms: 1200,
    input_tokens: 1000,
    output_tokens: 500,
    web_search_count: 0,
    cache_hit: false,
    citations: [{ url: "https://example.com", title: "src" }],
    error_code: null,
    estimated_cost_usd: 0.0123,
    ...over,
  };
}

describe("recordProviderCalls (T-M6-09)", () => {
  it("records one row per call with sequential idempotency keys", async () => {
    const { db, inserts } = makeDb();
    await recordProviderCalls(db, [call(), call({ operation: "web_search" })], {
      userId: "u1",
      xAccountId: "xa1",
      jobId: "job1",
      keyPrefix: "gen:job1",
    });
    expect(inserts).toHaveLength(2); // 1 row per call
    expect(inserts[0][P_IDEMPOTENCY]).toBe("gen:job1:0");
    expect(inserts[1][P_IDEMPOTENCY]).toBe("gen:job1:1");
  });

  it("keeps idempotency keys stable across re-invocation (DB unique dedupes)", async () => {
    const { db, inserts } = makeDb();
    const calls = [call()];
    const ctx = { userId: "u1", jobId: "job1", keyPrefix: "lrn:job1" };
    await recordProviderCalls(db, calls, ctx);
    await recordProviderCalls(db, calls, ctx); // 再実行しても同じkey → DBの unique で行は増えない
    expect(inserts[0][P_IDEMPOTENCY]).toBe("lrn:job1:0");
    expect(inserts[1][P_IDEMPOTENCY]).toBe("lrn:job1:0");
  });

  it("records failed calls with status=failed and the normalized error_code", async () => {
    const { db, inserts } = makeDb();
    await recordProviderCalls(db, [call({ status: "failed", error_code: "rate_limit" })], {
      userId: "u1",
      keyPrefix: "sug:job1",
    });
    expect(inserts[0][P_STATUS]).toBe("failed");
    expect(inserts[0][P_ERROR_CODE]).toBe("rate_limit");
  });

  it("stores the runtime unit-cost snapshot, and null when the cost is incomputable", async () => {
    const { db, inserts } = makeDb();
    await recordProviderCalls(db, [call({ estimated_cost_usd: 0.05 }), call({ estimated_cost_usd: null })], {
      userId: "u1",
      keyPrefix: "gen:job1",
    });
    expect(inserts[0][P_UNIT_COST]).toBe(0.05);
    expect(inserts[0][P_ESTIMATED_COST]).toBe(0.05);
    expect(inserts[1][P_UNIT_COST]).toBeNull(); // 算出不能 → null
    expect(inserts[1][P_ESTIMATED_COST]).toBeNull();
  });

  it("does not store post body, prompt, or secrets in the usage column", async () => {
    const { db, inserts } = makeDb();
    await recordProviderCalls(db, [call()], { userId: "u1", keyPrefix: "gen:job1" });
    const usage = JSON.parse(inserts[0][P_USAGE_JSON] as string);
    // usage は ProviderCall のみ（本文・prompt・APIキーのカラムを持たない）。
    for (const forbidden of ["text", "body", "prompt", "system", "user", "api_key", "apiKey", "content"]) {
      expect(usage).not.toHaveProperty(forbidden);
    }
    expect(Object.keys(usage).sort()).toEqual(
      [
        "cache_hit",
        "citations",
        "error_code",
        "estimated_cost_usd",
        "input_tokens",
        "latency_ms",
        "model",
        "operation",
        "output_tokens",
        "provider",
        "request_id",
        "status",
        "stop_reason",
        "web_search_count",
      ].sort(),
    );
  });
});

describe("providerCallToUsageEvent (T-M6-09)", () => {
  it("maps provider/operation/status/error_code and cost snapshot from the call", () => {
    const event = providerCallToUsageEvent(call({ operation: "web_search", estimated_cost_usd: null }), {
      userId: "u1",
      xAccountId: "xa1",
      jobId: "job1",
      idempotencyKey: "gen:job1:0",
    });
    expect(event).toMatchObject({
      userId: "u1",
      xAccountId: "xa1",
      jobId: "job1",
      provider: "anthropic",
      operation: "web_search",
      status: "succeeded",
      quantity: 1,
      unitCostUsd: null,
      estimatedCostUsd: null,
      idempotencyKey: "gen:job1:0",
    });
  });
});

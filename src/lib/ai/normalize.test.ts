import { describe, expect, it } from "vitest";

import {
  ProviderConfigError,
  canCombineSearchAndStructuredOutput,
  toProviderCall,
  verifyTextProvider,
} from "./normalize";
import type { TextGenResult } from "./types";

function result(overrides: Partial<TextGenResult> = {}): TextGenResult {
  return {
    provider: "anthropic",
    requestId: "req_1",
    text: "t",
    citations: [{ url: "https://x.test", title: "X" }],
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 80,
      webSearchRequests: 2,
      providerCalls: 1,
    },
    stopReason: "end_turn",
    ...overrides,
  };
}

describe("toProviderCall (要件02 §4.6 calls element)", () => {
  it("normalizes any provider result into the same shape", () => {
    const call = toProviderCall(result({ provider: "google", requestId: "g1" }), {
      model: "gemini-x",
      operation: "generate",
      latencyMs: 1200,
    });
    expect(call).toEqual({
      provider: "google",
      model: "gemini-x",
      operation: "generate",
      request_id: "g1",
      status: "succeeded",
      stop_reason: "end_turn",
      latency_ms: 1200,
      input_tokens: 100,
      output_tokens: 20,
      web_search_count: 2,
      cache_hit: true, // cacheReadInputTokens > 0
      citations: [{ url: "https://x.test", title: "X" }],
      error_code: null,
      estimated_cost_usd: null, // meta未指定は算出不能=null（T-M6-09）
    });
  });

  it("carries status/error/cost from meta and cache_hit=false with no cache read", () => {
    const call = toProviderCall(
      result({ usage: { ...result().usage, cacheReadInputTokens: 0 } }),
      {
        model: "m",
        operation: "news",
        latencyMs: 5,
        status: "failed",
        errorCode: "provider_error",
        estimatedCostUsd: 0.12,
      },
    );
    expect(call.cache_hit).toBe(false);
    expect(call.status).toBe("failed");
    expect(call.error_code).toBe("provider_error");
    expect(call.estimated_cost_usd).toBe(0.12);
  });
});

describe("canCombineSearchAndStructuredOutput", () => {
  it("defaults to false (fallback to JSON instruction + code validation)", () => {
    expect(canCombineSearchAndStructuredOutput("anthropic", "claude-x")).toBe(false);
    expect(canCombineSearchAndStructuredOutput("openai", "gpt-x")).toBe(false);
    expect(canCombineSearchAndStructuredOutput("google", "gemini-x")).toBe(false);
  });
});

describe("verifyTextProvider", () => {
  it("throws when the API key or model is missing (no implicit switch)", () => {
    expect(() =>
      verifyTextProvider({ provider: "openai", model: "m" }),
    ).toThrow(ProviderConfigError);
    expect(() =>
      verifyTextProvider({ provider: "openai", apiKey: "k" }),
    ).toThrow(ProviderConfigError);
  });

  it("passes when both are present", () => {
    expect(() =>
      verifyTextProvider({ provider: "openai", apiKey: "k", model: "m" }),
    ).not.toThrow();
  });
});

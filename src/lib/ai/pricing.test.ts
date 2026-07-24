import { describe, expect, it } from "vitest";

import { estimateProviderCost, PROVIDER_RATES } from "./pricing";
import { emptyUsage, type Provider } from "./types";

describe("estimateProviderCost", () => {
  it("returns 0 for zero usage", () => {
    for (const p of ["anthropic", "openai", "google"] as Provider[]) {
      expect(estimateProviderCost(p, emptyUsage())).toBe(0);
    }
  });

  it("prices input/output tokens per the anthropic rate table", () => {
    const cost = estimateProviderCost("anthropic", {
      ...emptyUsage(),
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(
      PROVIDER_RATES.anthropic.inputPerMTok + PROVIDER_RATES.anthropic.outputPerMTok,
    ); // 3 + 15 = 18
  });

  it("prices cache read/write and web search", () => {
    const cost = estimateProviderCost("anthropic", {
      ...emptyUsage(),
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
      webSearchRequests: 3,
    });
    const expected =
      PROVIDER_RATES.anthropic.cacheWritePerMTok +
      PROVIDER_RATES.anthropic.cacheReadPerMTok +
      3 * PROVIDER_RATES.anthropic.webSearchPerCall;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it("rounds to 6 decimals (numeric(12,6))", () => {
    const cost = estimateProviderCost("anthropic", {
      ...emptyUsage(),
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(cost).toBe(0.000105); // (10*3 + 5*15)/1e6
  });

  it("differs by provider", () => {
    const usage = { ...emptyUsage(), inputTokens: 1_000_000 };
    expect(estimateProviderCost("google", usage)).toBe(PROVIDER_RATES.google.inputPerMTok);
    expect(estimateProviderCost("openai", usage)).toBe(PROVIDER_RATES.openai.inputPerMTok);
  });

  it("returns null (算出不能) for a provider without a rate table", () => {
    expect(estimateProviderCost("bogus" as Provider, { ...emptyUsage(), inputTokens: 100 })).toBeNull();
  });
});

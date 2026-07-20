import { describe, expect, it } from "vitest";

import {
  MAX_WEIGHTED_LENGTH,
  countCashtags,
  exceedsWeightedLimit,
  isWithinWeightedLimit,
  weightedLength,
} from "./weighted-length";

describe("weightedLength / limit checks", () => {
  it("treats 280 half-width chars as OK and 281 as over", () => {
    expect(weightedLength("a".repeat(280))).toBe(280);
    expect(exceedsWeightedLimit("a".repeat(280))).toBe(false);
    expect(exceedsWeightedLimit("a".repeat(281))).toBe(true);
  });

  it("weights CJK x2: 140 Japanese chars OK, 141 over", () => {
    expect(weightedLength("あ".repeat(140))).toBe(280);
    expect(exceedsWeightedLimit("あ".repeat(140))).toBe(false);
    expect(exceedsWeightedLimit("あ".repeat(141))).toBe(true);
  });

  it("counts URLs as t.co fixed length regardless of real length", () => {
    const short = weightedLength("https://example.com/a");
    const long = weightedLength("https://example.com/" + "a".repeat(500));
    expect(short).toBe(long); // both t.co-normalized
    expect(long).toBeLessThan(30);
  });

  it("MAX_WEIGHTED_LENGTH is 280", () => {
    expect(MAX_WEIGHTED_LENGTH).toBe(280);
  });

  it("isWithinWeightedLimit rejects empty and over-limit", () => {
    expect(isWithinWeightedLimit("")).toBe(false);
    expect(isWithinWeightedLimit("hello")).toBe(true);
    expect(isWithinWeightedLimit("あ".repeat(141))).toBe(false);
  });

  it("respects a custom limit (e.g. PT-FIX)", () => {
    expect(exceedsWeightedLimit("a".repeat(100), 90)).toBe(true);
    expect(exceedsWeightedLimit("a".repeat(80), 90)).toBe(false);
  });
});

describe("countCashtags", () => {
  it("counts $TICKER occurrences and detects 2+", () => {
    expect(countCashtags("no cashtags here")).toBe(0);
    expect(countCashtags("watch $AAPL today")).toBe(1);
    expect(countCashtags("$AAPL vs $TSLA")).toBe(2);
    expect(countCashtags("$AAPL vs $TSLA and $NVDA")).toBeGreaterThanOrEqual(2);
  });
});

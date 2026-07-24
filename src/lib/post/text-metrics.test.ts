import { describe, expect, it } from "vitest";

import {
  countCashtags,
  measurePostText,
  weightedLength,
} from "./text-metrics";

describe("weightedLength (twitter-text compatible)", () => {
  it("counts ASCII as weight 1", () => {
    expect(weightedLength("hello")).toBe(5);
    expect(weightedLength("")).toBe(0);
  });

  it("counts CJK as weight 2", () => {
    expect(weightedLength("あ")).toBe(2);
    expect(weightedLength("日本語")).toBe(6);
  });

  it("counts any URL as the t.co fixed length (23)", () => {
    expect(weightedLength(`https://example.com/${"x".repeat(200)}`)).toBe(23);
  });

  it("handles the 280 boundary", () => {
    expect(weightedLength("a".repeat(280))).toBe(280);
    expect(weightedLength("a".repeat(281))).toBe(281);
    expect(weightedLength("あ".repeat(140))).toBe(280); // 140*2
    expect(weightedLength("あ".repeat(141))).toBe(282);
  });
});

describe("countCashtags", () => {
  it("counts cashtags", () => {
    expect(countCashtags("watch $AAPL today")).toBe(1);
    expect(countCashtags("$AAPL and $GOOG")).toBe(2);
    expect(countCashtags("no cashtags here")).toBe(0);
  });
});

describe("measurePostText", () => {
  it("flags within-limit and single-cashtag posts as ok", () => {
    const m = measurePostText("普通の投稿 $AAPL");
    expect(m.withinLimit).toBe(true);
    expect(m.cashtagCount).toBe(1);
    expect(m.cashtagOk).toBe(true);
    expect(m.empty).toBe(false);
  });

  it("flags over-limit posts", () => {
    const m = measurePostText("あ".repeat(141));
    expect(m.weightedLength).toBe(282);
    expect(m.withinLimit).toBe(false);
  });

  it("flags 2+ cashtags as not ok (auto-post block)", () => {
    const m = measurePostText("$AAPL $GOOG $MSFT");
    expect(m.cashtagCount).toBe(3);
    expect(m.cashtagOk).toBe(false);
  });

  it("flags whitespace-only text as empty", () => {
    expect(measurePostText("   ").empty).toBe(true);
  });
});

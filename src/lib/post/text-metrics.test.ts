import { describe, expect, it } from "vitest";

import {
  countCashtags,
  findOverLengthText,
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

describe("findOverLengthText（投稿直前の長さ再検証・T-M8-39）", () => {
  it("すべて上限内なら null", () => {
    expect(findOverLengthText(["あ".repeat(140), "hello"])).toBeNull();
  });

  it("上限（加重280）ちょうどは通す", () => {
    expect(weightedLength("あ".repeat(140))).toBe(280);
    expect(findOverLengthText(["あ".repeat(140)])).toBeNull();
  });

  it("超過した**最初の**ポストを返す（そこまでの本数を伝えられるように）", () => {
    const found = findOverLengthText(["ok", "あ".repeat(141), "あ".repeat(200)]);
    expect(found).toEqual({ index: 1, weightedLength: 282 });
  });

  it("URLはt.co固定長で数える（本文の見た目より長くなり得る）", () => {
    const text = `${"あ".repeat(130)}https://example.com/very/long/path/that/is/ignored`;
    expect(findOverLengthText([text])).toEqual({ index: 0, weightedLength: 283 });
  });
});

import { describe, expect, it } from "vitest";

import {
  normalizeTrafficSourceLabel,
  parseTrafficSource,
  trackingUrlFor,
  withTrafficSource,
} from "./traffic-source";

describe("流入元（T-M8-423）", () => {
  it("src は小文字の英数字・_・- の1〜32文字だけ通し、他は '' （直接・不明）", () => {
    expect(parseTrafficSource("x_bio")).toBe("x_bio");
    expect(parseTrafficSource(" Note-2026 ")).toBe("note-2026");
    expect(parseTrafficSource("")).toBe("");
    expect(parseTrafficSource(undefined)).toBe("");
    expect(parseTrafficSource(["a", "b"])).toBe("");
    expect(parseTrafficSource("日本語")).toBe("");
    expect(parseTrafficSource("a b")).toBe("");
    expect(parseTrafficSource("a".repeat(33))).toBe("");
    expect(parseTrafficSource("<script>")).toBe("");
  });

  it("名前は1〜60文字（前後の空白は落とす）", () => {
    expect(normalizeTrafficSourceLabel("  Xのプロフィール ")).toBe("Xのプロフィール");
    expect(normalizeTrafficSourceLabel("")).toBeNull();
    expect(normalizeTrafficSourceLabel("あ".repeat(61))).toBeNull();
    expect(normalizeTrafficSourceLabel(1)).toBeNull();
  });

  it("追跡URLとLP内リンクの引き継ぎ", () => {
    expect(trackingUrlFor("https://exosai.net", "x_bio")).toBe("https://exosai.net/?src=x_bio");
    expect(withTrafficSource("/signup", "x_bio")).toBe("/signup?src=x_bio");
    expect(withTrafficSource("/signup?next=%2Fapp", "x_bio")).toBe("/signup?next=%2Fapp&src=x_bio");
    expect(withTrafficSource("/signup", "")).toBe("/signup");
  });
});

import { describe, expect, it } from "vitest";

import { findProviderMarkup, newsOutcome } from "./scenarios";

describe("findProviderMarkup", () => {
  it("実測した cite タグを検出する（T-M7-20）", () => {
    const found = findProviderMarkup([
      '<cite index="8-1">本文</cite>。続き',
      "タグの無い本文",
    ]);
    expect(found).toContain('<cite index="8-1">');
    expect(found).toContain("</cite>");
  });

  it("コードフェンスの取り残しも検出する", () => {
    expect(findProviderMarkup(["```json のまま残った本文"])).toContain("```");
  });

  it("正常な本文では空", () => {
    expect(findProviderMarkup(["今週のAIまとめ📰", "条件は a < b です"])).toEqual([]);
  });
});

describe("newsOutcome（0件と全滅の区別・T-M7-24）", () => {
  it("0件かつ除外ありは全滅として失敗にする", () => {
    const r = newsOutcome(0, 4);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("全滅");
  });

  it("0件で除外も0件なら正常（該当ニュースが無いだけ）", () => {
    expect(newsOutcome(0, 0).ok).toBe(true);
  });

  it("取得できていれば除外があっても成功（件数は残す）", () => {
    const r = newsOutcome(3, 2);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("3件");
    expect(r.detail).toContain("2件");
  });
});

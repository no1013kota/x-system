import { describe, expect, it } from "vitest";

import { describeGenerated, findProviderMarkup, newsOutcome, onlyOutsideWindow } from "./scenarios";

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

describe("describeGenerated（生成物の形を測って見せる・T-M7-37）", () => {
  it("字数・改行の塊数・ハッシュタグ・URLを数える", () => {
    const post = "1行目です。\n2行目です。\n\n次の塊です。";
    const out = describeGenerated([post, "2ポスト目 #タグ https://example.com/a"]);
    expect(out).toContain("全2ポスト");
    expect(out).toContain("改行塊2");
    expect(out, "判定単位の加重文字数も出す").toMatch(/加重\d+/);
    expect(out).toContain("タグ1");
    expect(out).toContain("URL1");
  });

  it("先頭2ポストだけを載せる（報告を長くしない）", () => {
    const out = describeGenerated(["a", "b", "c", "d"]);
    expect(out).toContain("全4ポスト");
    expect(out).toContain("[1]");
    expect(out).toContain("[2]");
    expect(out).not.toContain("[3]");
  });

  it("本文をそのまま載せる（何が生成されたかを読めるようにする）", () => {
    expect(describeGenerated(["これが本文です"])).toContain("これが本文です");
  });
});

/**
 * 0件の意味をさらに分ける（T-M7-44）。2026-08-01、stagingの初回検証で5件すべてが
 * `published_at:too_old` になり「全滅（失敗）」と判定された。実際には**その時間帯に新しい
 * 記事が無かっただけ**で、運営者に直せるものは無い。直せない理由で赤くすると読まれなくなる。
 */
describe("newsOutcome — 窓外と契約違反を分ける", () => {
  it("窓外だけで0件なら成功（件数は出す）", () => {
    const r = newsOutcome(0, 5, { "published_at:too_old": 5 });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("5件はいずれも取得窓より古い");
  });

  it("契約違反が混じっていれば失敗（直すべきものがある）", () => {
    expect(newsOutcome(0, 3, { "title:too_big": 3 }).ok).toBe(false);
    expect(newsOutcome(0, 4, { "title:too_big": 1, "published_at:too_old": 3 }).ok).toBe(false);
  });

  it("除外0の0件は従来どおり成功", () => {
    const r = newsOutcome(0, 0, {});
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("除外も0件");
  });

  it("取得できていれば成功", () => {
    expect(newsOutcome(3, 1, { "title:too_big": 1 }).ok).toBe(true);
  });

  it("onlyOutsideWindow は理由が空なら false（判断材料が無い）", () => {
    expect(onlyOutsideWindow({})).toBe(false);
    expect(onlyOutsideWindow({ "published_at:too_old": 2 })).toBe(true);
    expect(onlyOutsideWindow({ "published_at:too_old": 2, "summary:too_big": 1 })).toBe(false);
  });
});

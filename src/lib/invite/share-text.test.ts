import { describe, expect, it } from "vitest";

import { fitsInPost, inviteShareText, weightedLength } from "./share-text";

const URL = "https://exos-ai.example.com/r/ab12cd";

describe("inviteShareText（招待のXシェア文・T-M8-276）", () => {
  it("Xの上限（280・日本語は1文字=2、URLは23）に収まる", () => {
    const text = inviteShareText(URL);
    expect(fitsInPost(text)).toBe(true);
    // 余白も見ておく（将来の追記で気付かず溢れないように）。
    expect(weightedLength(text.replace(URL, "")) + 23).toBeLessThan(280);
  });

  it("招待リンクと、試せることが必ず入る", () => {
    const text = inviteShareText(URL);
    expect(text).toContain(URL);
    expect(text).toContain("7日間無料");
    expect(text.endsWith(URL), "URLは末尾（Xのカード表示の位置）").toBe(true);
  });

  it("プロダクトの価値（学習・生成・予約と分析）が3つとも伝わる", () => {
    const text = inviteShareText(URL);
    for (const value of ["学習", "下書き", "予約投稿", "分析"]) {
      expect(text, `${value} が伝わらない`).toContain(value);
    }
  });

  /** 効果の断定は書かない（実測していないことを宣伝しない・要件06 §11の考え方）。 */
  it("誇張・断定表現を含まない", () => {
    const text = inviteShareText(URL);
    for (const banned of ["必ず", "保証", "確実に", "誰でも稼げ", "フォロワーが増えます"]) {
      expect(text, `誇張表現「${banned}」が入っている`).not.toContain(banned);
    }
  });
});

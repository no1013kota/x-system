import { describe, expect, it } from "vitest";

import {
  applyRecencyPolicy,
  clampSummary,
  clampTitle,
  NEWS_SUMMARY_MAX_LENGTH,
  NEWS_TITLE_MAX_LENGTH,
  normalizePublishedAt,
  pickValidItems,
} from "./item-rules";

/**
 * ニュースitem規則（T-M8-380で news-research.ts から移設）。
 * 移設前のテストのうち、保存規定として今も効くものをここで守り続ける。
 */
describe("newsItemSchema / pickValidItems", () => {
  const valid = {
    title: "GPT-5.6が一般提供開始",
    summary: "OpenAIがGPT-5.6を一般提供開始した。",
    source_url: "https://example.com/a",
    impact: "high" as const,
  };

  it("規定を満たすitemだけを残し、落とした件数と理由を返す", () => {
    const tooLong = { ...valid, summary: "x".repeat(NEWS_SUMMARY_MAX_LENGTH + 1), source_url: "https://example.com/b" };
    const r = pickValidItems([valid, tooLong, { nonsense: true }], 10);
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(2);
    expect(Object.keys(r.reasons).length).toBeGreaterThan(0);
  });

  /**
   * **http/https 以外の source_url を残さない**（T-M8-366の回帰・移設後も維持）。
   * source_url は画面で `<a href>` として描かれる。`z.url()` は `data:`・`javascript:` も通す。
   */
  it("http/https 以外の source_url を持つitemは落とす", () => {
    const r = pickValidItems(
      [
        { ...valid, source_url: "data:text/html,<script>1</script>" },
        { ...valid, source_url: "javascript:alert(1)" },
        { ...valid, source_url: "ftp://example.com/a" },
        { ...valid, source_url: "https://example.com/ok" },
      ],
      10,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].source_url).toBe("https://example.com/ok");
    expect(r.dropped).toBe(3);
  });

  it("上限で打ち切る", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...valid, source_url: `https://example.com/${i}` }));
    expect(pickValidItems(many, 5).items).toHaveLength(5);
  });
});

describe("normalizePublishedAt", () => {
  it("日付のみ・空白区切り・ISOを受け、読めないものは undefined", () => {
    expect(normalizePublishedAt("2026-07-28")).toBe("2026-07-28T00:00:00Z");
    expect(normalizePublishedAt("2026-07-28 09:43:00")).toBe("2026-07-28T09:43:00Z");
    expect(normalizePublishedAt("2026-07-28T09:43:00+09:00")).toBeTruthy();
    expect(normalizePublishedAt("いつか")).toBeUndefined();
    expect(normalizePublishedAt(123)).toBeUndefined();
  });
});

describe("applyRecencyPolicy", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const item = (published_at?: string) => ({
    title: "t",
    summary: "s",
    source_url: "https://example.com/a",
    impact: "mid" as const,
    published_at,
  });

  it("古すぎる（窓+24hより前）は捨て、未来は published_at を落として残す", () => {
    const r = applyRecencyPolicy(
      [
        item("2026-08-30T11:00:00Z"), // 窓内
        item("2026-08-26T00:00:00Z"), // 48+24hより前 → 捨てる
        item("2026-08-30T13:00:00Z"), // 未来 → published_at を落として残す
        item(undefined), // 日時なし → 残す
      ],
      { now, hours: 48 },
    );
    expect(r.items).toHaveLength(3);
    expect(r.dropped).toBe(1);
    expect(r.futureAdjusted).toBe(1);
    expect(r.items.find((i) => i.published_at === "2026-08-30T13:00:00Z")).toBeUndefined();
  });
});

describe("clampTitle / clampSummary", () => {
  it("上限を超える文字列は省略記号つきで切り詰める（捨てない側の道具）", () => {
    const long = "あ".repeat(NEWS_TITLE_MAX_LENGTH + 10);
    expect(clampTitle(long)).toHaveLength(NEWS_TITLE_MAX_LENGTH);
    expect(clampTitle(long).endsWith("…")).toBe(true);
    expect(clampSummary("短い")).toBe("短い");
  });
});

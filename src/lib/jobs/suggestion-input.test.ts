import { describe, expect, it } from "vitest";

import {
  buildDraftTagIndex,
  buildSuggestionInput,
  SUGGEST_POST_TEXT_CHARS,
  SUGGEST_TIMELINE_MAX,
  toJstLabel,
} from "./suggestion-input";

/**
 * SUGGEST 入力の組み立て（T-M8-91）。
 * タイムライン投稿 → `<posts>` 行の変換と、Exos投稿への型/テーマのタグ付けを固定する。
 */

function timelinePost(id: string, over: Partial<Parameters<typeof buildSuggestionInput>[0][number]> = {}) {
  return {
    id,
    text: `本文 ${id}`,
    createdAt: "2026-07-18T03:00:00.000Z",
    impressions: 100,
    likes: 5,
    reposts: 1,
    replies: 0,
    hasMedia: false,
    hasUrl: false,
    ...over,
  };
}

describe("toJstLabel", () => {
  it("UTCの ISO を JST の分単位ラベルへ変換する", () => {
    expect(toJstLabel("2026-07-18T03:00:00.000Z")).toBe("2026-07-18 12:00");
  });

  it("日付をまたぐ変換も正しい（UTC 20時 = JST 翌5時）", () => {
    expect(toJstLabel("2026-07-18T20:30:00.000Z")).toBe("2026-07-19 05:30");
  });

  it("読めない値は null（行ごと捨てない）", () => {
    expect(toJstLabel("not-a-date")).toBeNull();
    expect(toJstLabel(null)).toBeNull();
  });
});

describe("buildSuggestionInput", () => {
  it("タイムライン投稿を <posts> 行へ変換する", () => {
    const input = buildSuggestionInput([timelinePost("t1", { hasMedia: true, hasUrl: true })], new Map());
    expect(input.posts).toEqual([
      {
        id: "t1",
        text: "本文 t1",
        posted_at_jst: "2026-07-18 12:00",
        impressions: 100,
        likes: 5,
        reposts: 1,
        replies: 0,
        has_image: true,
        has_url: true,
        pattern: null,
        theme: null,
      },
    ]);
  });

  it("Exos AIで作った投稿には型とテーマが付く（drafts突合）", () => {
    const tags = buildDraftTagIndex([{ tweet_ids: ["t1", "t1b"], pattern_name: "ノウハウ・ハウツー", theme: "ai" }]);
    const input = buildSuggestionInput([timelinePost("t1"), timelinePost("t9")], tags);
    expect(input.posts[0]).toMatchObject({ pattern: "ノウハウ・ハウツー", theme: "ai" });
    // 外部の投稿は null（分からないものを推測しない）。
    expect(input.posts[1]).toMatchObject({ pattern: null, theme: null });
  });

  it("threadの2番目以降のtweet_idでも同じタグへ引ける", () => {
    const tags = buildDraftTagIndex([{ tweet_ids: ["head", "second"], pattern_name: "ニュース解説", theme: "sns" }]);
    const input = buildSuggestionInput([timelinePost("second")], tags);
    expect(input.posts[0]).toMatchObject({ pattern: "ニュース解説", theme: "sns" });
  });

  it("メトリクスが無い投稿（30日境界等）は null のまま渡す（0と区別する）", () => {
    const input = buildSuggestionInput(
      [timelinePost("t1", { impressions: null, likes: null, reposts: null, replies: null })],
      new Map(),
    );
    expect(input.posts[0]).toMatchObject({ impressions: null, likes: null, reposts: null, replies: null });
  });

  it("本文は空白を潰して先頭200字に切り詰める（絵文字を割らない）", () => {
    const long = "🎉".repeat(SUGGEST_POST_TEXT_CHARS + 50);
    const input = buildSuggestionInput([timelinePost("t1", { text: `a\n\n  b   c ${long}` })], new Map());
    expect(input.posts[0].text.startsWith("a b c ")).toBe(true);
    expect([...input.posts[0].text]).toHaveLength(SUGGEST_POST_TEXT_CHARS);
    // サロゲートペアの断片（置換文字）が出ないこと。
    expect(input.posts[0].text).not.toContain("�");
  });

  it("上限（SUGGEST_TIMELINE_MAX）を超える入力は切り詰める", () => {
    const many = Array.from({ length: SUGGEST_TIMELINE_MAX + 20 }, (_, i) => timelinePost(`t${i}`));
    const input = buildSuggestionInput(many, new Map());
    expect(input.posts).toHaveLength(SUGGEST_TIMELINE_MAX);
  });

  /**
   * **この数字がレポート1回の費用をほぼ決める**（1件300字なので50件で約1.5万字）。
   * 100→50（T-M8-335・運営者の指示 2026-08-27）。取得・保存の上限（TIMELINE_FETCH_MAX=100 /
   * SUGGEST_ANALYZE_MAX=300）とは別物で、そちらは変えていない。
   */
  it("LLMへ渡すのは50件（変えるとレポートの費用が変わる）", () => {
    expect(SUGGEST_TIMELINE_MAX).toBe(50);
  });
});

describe("buildDraftTagIndex", () => {
  it("tweet_ids が null の行を無視する", () => {
    const tags = buildDraftTagIndex([{ tweet_ids: null, pattern_name: "ニュース解説", theme: "ai" }]);
    expect(tags.size).toBe(0);
  });
});

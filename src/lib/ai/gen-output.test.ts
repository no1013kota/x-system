import { describe, expect, it } from "vitest";

import { weightedLength } from "@/lib/text/weighted-length";

import { genOutputSchema, postsToThread, stripProviderMarkup } from "./gen-output";

describe("genOutputSchema", () => {
  it("accepts the SYS-GEN success/failure shapes", () => {
    expect(
      genOutputSchema.safeParse({ posts: ["a", "b"], sources: ["https://x"], error: null }).success,
    ).toBe(true);
    expect(
      genOutputSchema.safeParse({ posts: [], sources: [], error: "理由" }).success,
    ).toBe(true);
  });

  it("rejects wrong shapes (objects instead of strings, missing fields)", () => {
    expect(genOutputSchema.safeParse({ posts: [{ text: "a" }], sources: [], error: null }).success).toBe(
      false,
    );
    expect(genOutputSchema.safeParse({ posts: ["a"], error: null }).success).toBe(false);
  });
});

describe("postsToThread", () => {
  it("maps posts to thread items with weighted_length and sources on the last post", () => {
    const thread = postsToThread(["こんにちは", "詳しくはこちら"], ["https://src"]);
    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({ local_id: "p1", text: "こんにちは", sources: [], warnings: [] });
    expect(thread[0].weighted_length).toBe(10); // 5 CJK * 2
    expect(thread[1].local_id).toBe("p2");
    expect(thread[1].sources).toEqual(["https://src"]); // sources on final post
  });

  it("handles a single post", () => {
    const thread = postsToThread(["only"], ["https://s"]);
    expect(thread).toHaveLength(1);
    expect(thread[0].sources).toEqual(["https://s"]);
    expect(thread[0].weighted_length).toBe(4);
  });
});

describe("stripProviderMarkup（provider引用マークアップの除去）", () => {
  // 2026-07-27 の P-6 実測で、Anthropic が JSON 文字列の中へ cite タグを書いて返した。
  const REAL =
    '<cite index="8-1">🔄【モデル世代交代が加速】OpenAIが「GPT-5.6」を3段階モデルとして公開。' +
    "AIエージェント時代は新モデルの登場が月単位になっています</cite>。個人事業主には朗報です。";

  it("実測した cite タグを除去し、本文は残す", () => {
    const out = stripProviderMarkup(REAL);
    expect(out).not.toContain("<cite");
    expect(out).not.toContain("</cite>");
    expect(out.startsWith("🔄【モデル世代交代が加速】")).toBe(true);
    expect(out.endsWith("個人事業主には朗報です。")).toBe(true);
  });

  it("検証（genOutputSchema）の時点で除去される", () => {
    const parsed = genOutputSchema.parse({
      posts: [REAL, "タグなしの本文"],
      sources: [],
      error: null,
    });
    expect(parsed.posts[0]).not.toContain("<cite");
    expect(parsed.posts[1]).toBe("タグなしの本文");
  });

  it("除去後の文字数で weighted_length を数える", () => {
    const [item] = postsToThread(genOutputSchema.parse({
      posts: [REAL], sources: [], error: null,
    }).posts, []);
    expect(item.text).not.toContain("<cite");
    expect(item.weighted_length).toBe(weightedLength(item.text));
    // タグ込みで数えると実際より長くなる（文字数判定が狂う）。
    expect(item.weighted_length).toBeLessThan(weightedLength(REAL));
  });

  it("引用タグ以外の < は残す（本文を壊さない）", () => {
    expect(stripProviderMarkup("条件は a < b です")).toBe("条件は a < b です");
    expect(stripProviderMarkup("<b>強調</b>")).toBe("<b>強調</b>");
  });
});

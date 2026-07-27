import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseAndValidate, stripCodeFence } from "./parse";

const schema = z.object({ posts: z.array(z.object({ text: z.string() })) });

describe("stripCodeFence", () => {
  it("removes ```json fences", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("removes bare ``` fences", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves plain text untouched", () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseAndValidate", () => {
  it("parses raw valid JSON matching the schema", () => {
    const r = parseAndValidate('{"posts":[{"text":"hi"}]}', schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.posts[0].text).toBe("hi");
  });

  it("parses code-fenced JSON by stripping the fence", () => {
    const r = parseAndValidate('```json\n{"posts":[{"text":"hi"}]}\n```', schema);
    expect(r.ok).toBe(true);
  });

  it("fails on non-JSON text", () => {
    expect(parseAndValidate("これはJSONではありません", schema).ok).toBe(false);
  });

  it("fails when JSON parses but violates the schema", () => {
    expect(parseAndValidate('{"posts":"not-an-array"}', schema).ok).toBe(false);
  });

  // 以下は 2026-07-27 に P-6（Web検索あり）で実際に返ってきた形。Web検索を使うと provider は
  // 「JSONのみ」と指示しても前置きを付けるため、修復callでも解消せず生成が全滅していた。
  it("前置き文の後ろにあるコードフェンス付きJSONを拾う（実測1回目）", () => {
    const text =
      "news_digestが空のため、Web検索で直近7日間のAI関連ニュースを収集します。\n\n" +
      "重要なトピックは以下の通りです：\n\n1. GPT-5.6が一般提供開始\n\n" +
      "それでは、これらを踏まえてX用スレッドを作成します。\n\n" +
      '```json\n{"posts":[{"text":"今週のAIまとめ"}]}\n```';
    const r = parseAndValidate(text, schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.posts[0].text).toBe("今週のAIまとめ");
  });

  it("前置き文の後ろにあるフェンス無しJSONを拾う（実測2回目・修復指示後）", () => {
    const text =
      "Web検索で直近7日間のAI関連ニュースを調査します。検索結果に基づいて、" +
      "スレッド形式で投稿を作成します。\n\n" +
      '{"posts":[{"text":"今週のAI業界まとめ📰"}]}';
    const r = parseAndValidate(text, schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.posts[0].text).toBe("今週のAI業界まとめ📰");
  });

  it("本文に波括弧・引用符・エスケープが入っていても壊れない", () => {
    const text =
      "説明文です。\n" +
      '{"posts":[{"text":"設定は {\\"mode\\": \\"auto\\"} と書きます"},{"text":"閉じ括弧 } も本文に出ます"}]}';
    const r = parseAndValidate(text, schema);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.posts).toHaveLength(2);
      expect(r.value.posts[0].text).toContain('{"mode": "auto"}');
    }
  });

  it("後書きが付いていても拾う", () => {
    const text = '{"posts":[{"text":"本文"}]}\n\n以上が今回のスレッドです。';
    expect(parseAndValidate(text, schema).ok).toBe(true);
  });

  it("配列を直接返す形にも対応する", () => {
    const arraySchema = z.array(z.object({ text: z.string() }));
    const r = parseAndValidate('前置き。\n[{"text":"a"},{"text":"b"}]', arraySchema);
    expect(r.ok).toBe(true);
  });

  it("前置きだけでJSONが無ければ失敗のまま（誤検出しない）", () => {
    expect(parseAndValidate("検索します。結果は見つかりませんでした。", schema).ok).toBe(false);
  });

  it("抽出できてもスキーマに合わなければ失敗する", () => {
    const text = '説明文。\n{"posts":"not-an-array"}';
    expect(parseAndValidate(text, schema).ok).toBe(false);
  });
});

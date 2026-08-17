import { describe, expect, it } from "vitest";

import { reduceWebSearchMaxUses } from "../ai/anthropic";
import { SYSTEM_DEFAULT_TEMPLATES } from "../prompts/gen-prompts";
import {
  parsePatternSpec,
  patternPrompt,
  scheduledPostSlots,
  sourceRequiredForSpec,
  webSearchForSpec,
  type PatternSpec,
} from "./pattern-spec";

/**
 * T-M8-129 U2。**旧 `switch (pattern)` と同じ結果になることを固定する。**
 *
 * 生成の振る舞いを `post_patterns` から引く形へ移すが、既定6種については
 * 何も変わってはいけない。ここが崩れると「見た目は同じなのに検索回数が減った」
 * のような、利用者からは原因の分からない劣化になる。
 *
 * 期待値は移行前のコードから写した:
 * - `baseWebSearchForPattern`: p1/p4→4回、p3/p6→3回、p2→URLありのみ2回、p5→なし
 * - `sourceRequired`: p1/p4/p6→常に必須、p2/p3→URLありのとき必須、p5→不要
 */

/** seed が入れる既定値（`supabase/migrations/20260818000001_post_patterns.sql`）。 */
const SEEDED: Record<string, Omit<PatternSpec, "id" | "name" | "description" | "prompt">> = {
  p1: {
    seedKey: "p1",
    maxPostsEdit: 6,
    maxPosts: 4,
    webSearchPolicy: "always",
    webSearchMaxUses: 4,
    sourcePolicy: "always",
    includeNewsDigest: false,
    asksUserOpinion: false,
    requiresQuoteUrl: false,
  },
  p2: {
    seedKey: "p2",
    maxPostsEdit: 1,
    maxPosts: 1,
    webSearchPolicy: "with_url",
    webSearchMaxUses: 2,
    sourcePolicy: "with_url",
    includeNewsDigest: false,
    asksUserOpinion: true,
    requiresQuoteUrl: false,
  },
  p3: {
    seedKey: "p3",
    maxPostsEdit: 7,
    maxPosts: 6,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "with_url",
    includeNewsDigest: false,
    asksUserOpinion: false,
    requiresQuoteUrl: false,
  },
  p4: {
    seedKey: "p4",
    maxPostsEdit: 5,
    maxPosts: 2,
    webSearchPolicy: "always",
    webSearchMaxUses: 4,
    sourcePolicy: "always",
    includeNewsDigest: false,
    asksUserOpinion: false,
    requiresQuoteUrl: false,
  },
  p5: {
    seedKey: "p5",
    maxPostsEdit: 3,
    maxPosts: 3,
    webSearchPolicy: "never",
    webSearchMaxUses: 0,
    sourcePolicy: "never",
    includeNewsDigest: false,
    asksUserOpinion: false,
    requiresQuoteUrl: true,
  },
  p6: {
    seedKey: "p6",
    maxPostsEdit: 7,
    maxPosts: 5,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "always",
    includeNewsDigest: true,
    asksUserOpinion: false,
    requiresQuoteUrl: false,
  },
};

function spec(seedKey: string, overrides: Partial<PatternSpec> = {}): PatternSpec {
  return {
    id: `id-${seedKey}`,
    name: `名前-${seedKey}`,
    description: null,
    prompt: null,
    ...SEEDED[seedKey],
    ...overrides,
  };
}

describe("webSearchForSpec（旧 baseWebSearchForPattern と一致する）", () => {
  const cases: [string, boolean, number | undefined][] = [
    ["p1", false, 4],
    ["p1", true, 4],
    ["p4", false, 4],
    ["p3", false, 3],
    ["p6", false, 3],
    ["p2", false, undefined], // URLが無ければ検索しない
    ["p2", true, 2],
    ["p5", false, undefined],
    ["p5", true, undefined],
  ];

  for (const [seedKey, hasUrl, expected] of cases) {
    it(`${seedKey}（URL${hasUrl ? "あり" : "なし"}）→ ${expected ?? "検索しない"}`, () => {
      const result = webSearchForSpec(spec(seedKey), hasUrl, 1, reduceWebSearchMaxUses);
      expect(result?.maxUses).toBe(expected);
    });
  }

  it("再試行では1段階ずつ縮小する（provider側の規則をそのまま使う）", () => {
    expect(webSearchForSpec(spec("p1"), false, 2, reduceWebSearchMaxUses)?.maxUses).toBe(2);
    expect(webSearchForSpec(spec("p1"), false, 3, reduceWebSearchMaxUses)?.maxUses).toBe(1);
    expect(webSearchForSpec(spec("p3"), false, 2, reduceWebSearchMaxUses)?.maxUses).toBe(1);
  });

  it("回数0は方針に関わらず検索しない（DBのCHECKと同じ意味）", () => {
    expect(
      webSearchForSpec(spec("p1", { webSearchMaxUses: 0 }), true, 1, reduceWebSearchMaxUses),
    ).toBeUndefined();
  });
});

describe("sourceRequiredForSpec（旧 sourceRequired と一致する）", () => {
  const cases: [string, boolean, boolean][] = [
    ["p1", false, true],
    ["p4", false, true],
    ["p6", false, true],
    ["p2", false, false],
    ["p2", true, true],
    ["p3", false, false],
    ["p3", true, true],
    ["p5", false, false],
    ["p5", true, false],
  ];
  for (const [seedKey, hasUrl, expected] of cases) {
    it(`${seedKey}（URL${hasUrl ? "あり" : "なし"}）→ ${expected ? "必須" : "不要"}`, () => {
      expect(sourceRequiredForSpec(spec(seedKey), hasUrl)).toBe(expected);
    });
  }
});

/**
 * 予約実行の投稿枠（要件04 §7.1 に書かれている値）。**移行前の `ROLLBACK_SAFE_BUDGET` と
 * 一致していなければならない**——ここがずれると premium の自動投稿が早く止まる／
 * 枠を超えて動く、のどちらかになる。
 */
describe("scheduledPostSlots（要件04 §7.1 の値と一致する）", () => {
  const cases: [string, number, number][] = [
    ["p1", 10, 1],
    ["p2", 1, 0],
    ["p3", 12, 1],
    ["p4", 8, 1],
    ["p6", 12, 1],
  ];
  for (const [seedKey, normal, url] of cases) {
    it(`${seedKey} → 通常${normal}＋URL${url}`, () => {
      expect(scheduledPostSlots(spec(seedKey))).toEqual({ normal, url });
    });
  }
});

describe("patternPrompt", () => {
  it("prompt が null ならシステム既定（コード定数）を使う", () => {
    expect(patternPrompt(spec("p1"))).toBe(SYSTEM_DEFAULT_TEMPLATES.p1);
  });

  it("prompt があればそれを使う", () => {
    expect(patternPrompt(spec("p1", { prompt: "# 自分の指示" }))).toBe("# 自分の指示");
  });

  it("自作（seedKey なし）でプロンプトが無ければ null（勝手に既定を当てない）", () => {
    expect(patternPrompt(spec("p1", { seedKey: null, prompt: null }))).toBeNull();
  });
});

describe("parsePatternSpec", () => {
  const valid = {
    id: "11111111-1111-1111-1111-111111111111",
    seed_key: "p1",
    name: "ニュース解説",
    description: "説明",
    prompt: null,
    max_posts: 4,
    max_posts_edit: 6,
    web_search_policy: "always",
    web_search_max_uses: 4,
    source_policy: "always",
    include_news_digest: false,
    asks_user_opinion: false,
    requires_quote_url: false,
  };

  it("`pattern_spec_of()` の形をそのまま読める", () => {
    const parsed = parsePatternSpec(valid);
    expect(parsed?.name).toBe("ニュース解説");
    expect(parsed?.seedKey).toBe("p1");
    expect(parsed?.maxPosts).toBe(4);
    expect(parsed?.prompt).toBeNull();
  });

  it("自作パターン（seed_key が null）も読める", () => {
    const parsed = parsePatternSpec({ ...valid, seed_key: null, prompt: "# 自分の指示" });
    expect(parsed?.seedKey).toBeNull();
    expect(parsed?.prompt).toBe("# 自分の指示");
  });

  // **既定値で埋めない。** 壊れた入力を補うと、意図した設定との区別がつかなくなる。
  const broken: [string, unknown][] = [
    ["null", null],
    ["配列", []],
    ["名前が空", { ...valid, name: "" }],
    ["idが無い", { ...valid, id: undefined }],
    ["ポスト数が0", { ...valid, max_posts: 0 }],
    ["ポスト数が小数", { ...valid, max_posts: 1.5 }],
    ["検索方針が未知の値", { ...valid, web_search_policy: "sometimes" }],
    ["出典方針が未知の値", { ...valid, source_policy: "maybe" }],
    ["検索回数が負", { ...valid, web_search_max_uses: -1 }],
  ];
  for (const [label, value] of broken) {
    it(`${label} は null を返す（呼び出し側が失敗として扱える）`, () => {
      expect(parsePatternSpec(value)).toBeNull();
    });
  }

  it("未知の seed_key は自作扱いにする（enumを増やしても壊れない）", () => {
    expect(parsePatternSpec({ ...valid, seed_key: "p9" })?.seedKey).toBeNull();
    // `image` は画像プロンプトの kind で、投稿の型ではない（DBのCHECKと同じ集合にする）。
    expect(parsePatternSpec({ ...valid, seed_key: "image" })?.seedKey).toBeNull();
  });
});

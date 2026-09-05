import { describe, expect, it } from "vitest";

import { reduceWebSearchMaxUses } from "../ai/anthropic";
import { SYSTEM_DEFAULT_TEMPLATES } from "../prompts/gen-prompts";
import { extractPlaceholderNames, placeholdersForFill, fillPlaceholders,
  buildPatternRules,
  parsePatternSpec,
  patternPrompt,
  scheduledPostSlots,
  sourceRequiredForSpec,
  webSearchForSpec,
  type PatternSpec,
} from "./pattern-spec";
import { validatePlaceholders } from "./post-patterns-store";

/**
 * T-M8-129 U2。**seed の既定値を通したとき、旧 `switch (pattern)` と同じ結果になることを固定する。**
 *
 * 生成の振る舞いを `post_patterns` から引く形へ移した。ここが崩れると「見た目は同じなのに検索回数が減った」
 * のような、利用者からは原因の分からない劣化になる。
 *
 * 期待値は seed の現在値から導く（fixture は seed 関数の値を写す。設定を変えたら migration と同時に直す）:
 * - Web検索: 既定6種すべて always／最大3回（2026-09-05・T-M8-442・D-57。それまで p2 は URLありのみ2回、p5 は使わない）
 * - `sourceRequired`: p1/p4/p6→常に必須、p2/p3→URLありのとき必須、p5→不要
 */

/** seed が入れる既定値（`supabase/migrations/20260905000002_web_search_all_patterns.sql` の seed 関数）。 */
const SEEDED: Record<string, Omit<PatternSpec, "id" | "name" | "description" | "prompt">> = {
  p1: {
    seedKey: "p1",
    maxPostsEdit: 6,
    maxPosts: 4,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "always",
    includeNewsDigest: false,
    requiresQuoteUrl: false,
    placeholders: [],
  },
  p2: {
    seedKey: "p2",
    maxPostsEdit: 1,
    maxPosts: 1,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "with_url",
    includeNewsDigest: false,
    requiresQuoteUrl: false,
    placeholders: [],
  },
  p3: {
    seedKey: "p3",
    maxPostsEdit: 7,
    maxPosts: 6,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "with_url",
    includeNewsDigest: false,
    requiresQuoteUrl: false,
    placeholders: [],
  },
  p4: {
    seedKey: "p4",
    maxPostsEdit: 5,
    maxPosts: 2,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "always",
    includeNewsDigest: false,
    requiresQuoteUrl: false,
    placeholders: [],
  },
  p5: {
    seedKey: "p5",
    maxPostsEdit: 3,
    maxPosts: 3,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "never",
    includeNewsDigest: false,
    requiresQuoteUrl: true,
    placeholders: [],
  },
  p6: {
    seedKey: "p6",
    maxPostsEdit: 7,
    maxPosts: 5,
    webSearchPolicy: "always",
    webSearchMaxUses: 3,
    sourcePolicy: "always",
    includeNewsDigest: true,
    requiresQuoteUrl: false,
    placeholders: [],
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

describe("webSearchForSpec（seed の既定値で旧 baseWebSearchForPattern と一致する）", () => {
  // 既定6種は 2026-09-05 以降すべて always／最大3回。URLの有無で変わらない（T-M8-442）。
  const cases: [string, boolean, number | undefined][] = [
    ["p1", false, 3],
    ["p1", true, 3],
    ["p4", false, 3],
    ["p3", false, 3],
    ["p6", false, 3],
    ["p2", false, 3],
    ["p2", true, 3],
    ["p5", false, 3],
    ["p5", true, 3],
  ];

  for (const [seedKey, hasUrl, expected] of cases) {
    it(`${seedKey}（URL${hasUrl ? "あり" : "なし"}）→ ${expected ?? "検索しない"}`, () => {
      const result = webSearchForSpec(spec(seedKey), hasUrl, 1, reduceWebSearchMaxUses);
      expect(result?.maxUses).toBe(expected);
    });
  }

  // 方針 with_url／never は seed からは消えたが列挙値としては残る（2026-09-05 までの P-2／P-5 の設定）。
  it("with_url はURLがあるときだけ検索する", () => {
    const withUrl = spec("p2", { webSearchPolicy: "with_url", webSearchMaxUses: 2 });
    expect(webSearchForSpec(withUrl, false, 1, reduceWebSearchMaxUses)).toBeUndefined();
    expect(webSearchForSpec(withUrl, true, 1, reduceWebSearchMaxUses)?.maxUses).toBe(2);
  });

  it("never はURLがあっても検索しない", () => {
    expect(
      webSearchForSpec(spec("p5", { webSearchPolicy: "never" }), true, 1, reduceWebSearchMaxUses),
    ).toBeUndefined();
  });

  it("再試行では1段階ずつ縮小する（provider側の規則をそのまま使う・下限1）", () => {
    expect(webSearchForSpec(spec("p1"), false, 2, reduceWebSearchMaxUses)?.maxUses).toBe(1);
    expect(webSearchForSpec(spec("p1"), false, 3, reduceWebSearchMaxUses)?.maxUses).toBe(1);
    expect(webSearchForSpec(spec("p3"), false, 2, reduceWebSearchMaxUses)?.maxUses).toBe(1);
    // 4回から始めると 4→2→1 と2段階で縮む
    const four = spec("p1", { webSearchMaxUses: 4 });
    expect(webSearchForSpec(four, false, 2, reduceWebSearchMaxUses)?.maxUses).toBe(2);
    expect(webSearchForSpec(four, false, 3, reduceWebSearchMaxUses)?.maxUses).toBe(1);
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
 * 予約実行の投稿枠（要件04 §7.1 に書かれている値）。**要件04 の表と一致していなければならない**
 * ——ここがずれると premium の自動投稿が早く止まる／枠を超えて動く、のどちらかになる。
 * P-2 は 2026-09-05 に Web検索 always になったため「通常0＋URL1」（それまでは通常1＋URL0・T-M8-442）。
 */
describe("scheduledPostSlots（要件04 §7.1 の値と一致する）", () => {
  const cases: [string, number, number][] = [
    ["p1", 10, 1],
    ["p2", 0, 1],
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

/**
 * T-M8-131。**設定がAIへ渡る文になっているか。**
 *
 * 以前は分量も参考URLの方針もAIに一言も伝えず、生成後に切り詰め・検証していた。
 * 「設定したのに効いていない」に見える状態だったので、文の形を固定する。
 */
describe("buildPatternRules（設定をAIへ渡す文）", () => {
  const rules = (seedKey: string, over: Partial<PatternSpec> = {}, ctx = {}) =>
    buildPatternRules(spec(seedKey, over), {
      hasInputUrl: false,
      webSearchMaxUses: 4,
      ...ctx,
    });

  it("スレッド数を明示する（0は単発と分かる書き方）", () => {
    expect(rules("p2")).toContain("分量: メインポストのみ");
    expect(rules("p2")).toContain("posts は1要素");
    expect(rules("p1")).toContain("分量: メインポスト＋スレッド最大3");
    expect(rules("p1")).toContain("合計4要素以内");
  });

  it("Web検索の実際の回数を書く（再試行で縮んだ値をそのまま渡す）", () => {
    expect(rules("p1", {}, { webSearchMaxUses: 2 })).toContain("Web検索: 使う（最大2回）");
    expect(rules("p1", {}, { webSearchMaxUses: null })).toContain("Web検索: 使わない");
  });

  it("URLが無くて検索しない場合（方針 with_url）は、その理由まで書く", () => {
    const text = rules(
      "p2",
      { webSearchPolicy: "with_url" },
      { webSearchMaxUses: null, hasInputUrl: false },
    );
    expect(text).toContain("<user_input>に参考URLが無いため");
  });

  it("参考URLの方針を書く。**本文にURLを書かせない**ことも毎回伝える", () => {
    expect(rules("p1")).toContain("参考URL: 内容の根拠になるURLを1つ以上 sources へ入れる");
    expect(rules("p1")).toContain("本文にURLは書かない");
    expect(rules("p5")).toContain("参考URL: 付けない");
  });

  it("「入力があるときだけ」はURLの有無で言うことが変わる", () => {
    expect(rules("p3", {}, { hasInputUrl: true })).toContain("<user_input>のURLを含め");
    expect(rules("p3", {}, { hasInputUrl: false })).toContain("無理に付けない");
  });
});

describe("extractPlaceholderNames（T-M8-186）", () => {
  it("本文の {名前} を出現順・重複なしで取り出す", () => {
    expect(extractPlaceholderNames("A{題材}B{対象読者}C{題材}")).toEqual(["題材", "対象読者"]);
  });

  it("{{...}}（システム変数の記法）と使えない文字入りは拾わない", () => {
    expect(extractPlaceholderNames("x{{limit}}y")).toEqual([]);
    expect(extractPlaceholderNames("a{改行\nあり}b{ok}")).toEqual(["ok"]);
    expect(extractPlaceholderNames("{<tag>}{ok}")).toEqual(["ok"]);
  });

  it("21字以上の名前は拾わず、上限は10件", () => {
    expect(extractPlaceholderNames(`{${"あ".repeat(21)}}`)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => `{p${i}}`).join(" ");
    expect(extractPlaceholderNames(many)).toHaveLength(10);
  });

  it("保存時の検証（validatePlaceholders）と同じ名前規則である", () => {
    // 導出した名前をそのまま宣言として保存できること（規則がズレると保存で落ちる）。
    const names = extractPlaceholderNames("{題材}{対象読者}");
    expect(() =>
      validatePlaceholders(
        names.map((name) => ({ name })),
        "{題材}{対象読者}",
      ),
    ).not.toThrow();
  });
});

describe("placeholdersForFill（T-M8-186）", () => {
  it("宣言に加えて、値があり本文に実在する名前を差し込み対象にする", () => {
    const set = placeholdersForFill(
      "本文 {宣言済み} と {追加分} と {値なし}",
      [{ name: "宣言済み" }],
      { 追加分: "x", 本文に無い: "y" },
    );
    expect(set.map((p) => p.name).sort()).toEqual(["宣言済み", "追加分"].sort());
  });

  it("fillPlaceholdersと組で、上書きで増やした項目が差し込まれる", () => {
    const prompt = "お題: {お題}";
    const filled = fillPlaceholders(
      prompt,
      placeholdersForFill(prompt, [], { お題: "週次ふりかえり" }),
      { お題: "週次ふりかえり" },
    );
    expect(filled).toBe("お題: 週次ふりかえり");
  });
});

describe("buildPatternRules 文字数（T-M8-391）", () => {
  const spec = { maxPosts: 4, webSearchPolicy: "always", sourcePolicy: "always" } as never;
  it("premiumは長文可、非premiumは280以内を明示する", () => {
    const premium = buildPatternRules(spec, { hasInputUrl: false, webSearchMaxUses: 2, premium: true });
    expect(premium).toContain("文字数: 長文可");
    const free = buildPatternRules(spec, { hasInputUrl: false, webSearchMaxUses: 2 });
    expect(free).toContain("文字数: 1ポストは加重280字");
  });
});

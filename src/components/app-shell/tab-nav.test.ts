import { describe, expect, it } from "vitest";

import { tabLinkClassName, tabNavClassName } from "./tab-nav";

/**
 * TabNav 抽出のクラス集合等価テスト（要件06 各画面タブ）。UI のクラス文字列ドリフトは
 * typecheck/lint/build のどれも捕捉しないため、settings/posts/ai-settings 各画面の現行クラス
 * 集合と一致することを（順序非依存で）検証してデグレを防ぐ。
 */
const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

// ai-settings のリンク固有クラス（現行 page.tsx の値）。
const AI_LINK_EXTRA =
  "shrink-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring";

describe("tabNavClassName", () => {
  it("settings/posts の nav 共通クラス", () => {
    expect(set(tabNavClassName())).toEqual(set("flex gap-2 border-b border-hairline"));
  });

  it("ai-settings の nav（gap-1 が gap-2 を上書き）", () => {
    expect(set(tabNavClassName("mt-7 gap-1 overflow-x-auto"))).toEqual(
      set("mt-7 flex gap-1 overflow-x-auto border-b border-hairline"),
    );
  });
});

describe("tabLinkClassName", () => {
  it("settings/posts の active/inactive 共通クラス", () => {
    expect(set(tabLinkClassName(true))).toEqual(
      set("border-b-2 px-4 py-2.5 text-body font-medium transition-colors duration-150 border-brand text-brand"),
    );
    expect(set(tabLinkClassName(false))).toEqual(
      set("border-b-2 px-4 py-2.5 text-body font-medium transition-colors duration-150 border-transparent text-ink-2 hover:text-ink"),
    );
  });

  it("ai-settings の active/inactive（追加クラス差し込み後も集合等価）", () => {
    expect(set(tabLinkClassName(true, AI_LINK_EXTRA))).toEqual(
      set(
        "shrink-0 border-b-2 px-4 py-2.5 text-body font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring border-brand text-brand",
      ),
    );
    expect(set(tabLinkClassName(false, AI_LINK_EXTRA, "hover:text-foreground"))).toEqual(
      set(
        "shrink-0 border-b-2 px-4 py-2.5 text-body font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring border-transparent text-ink-2 hover:text-foreground",
      ),
    );
  });
});

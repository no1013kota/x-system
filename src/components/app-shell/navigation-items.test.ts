import { describe, expect, it } from "vitest";

import { ICON_PATHS } from "@/components/ui/icon-paths";

import { APP_NAVIGATION_ITEMS } from "./navigation-items";

describe("APP_NAVIGATION_ITEMS", () => {
  it("新デザインの7項目を表示順で定義する（T-M8-04）", () => {
    // ラベルはヘッダーのパンくずにもなるので、**その画面のh1と一致していること**が要る
    // （T-M8-23。以前は `/app/ai-settings` のラベルが「アカウント.md」で本文の「AI設定」と食い違っていた）。
    expect(APP_NAVIGATION_ITEMS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/app", label: "ホーム" },
      { href: "/app/news", label: "最新ニュース" },
      { href: "/app/posts", label: "投稿作成" },
      { href: "/app/schedule", label: "スケジュール" },
      { href: "/app/analytics", label: "投稿分析" },
      { href: "/app/ai-settings", label: "AI設定" },
      { href: "/app/settings", label: "設定" },
    ]);
  });

  it("ルートもアイコンも重複しない", () => {
    const count = APP_NAVIGATION_ITEMS.length;
    expect(new Set(APP_NAVIGATION_ITEMS.map((item) => item.href)).size).toBe(count);
    expect(new Set(APP_NAVIGATION_ITEMS.map((item) => item.icon)).size).toBe(count);
  });

  it("**アイコンが実在する**（生成済みの定義に含まれる）", () => {
    // 名前を打ち間違えると実行時に空のSVGになるだけで気付けない。ここで落とす。
    for (const item of APP_NAVIGATION_ITEMS) {
      expect(ICON_PATHS[item.icon], `${item.label} のアイコン ${item.icon}`).toBeTruthy();
    }
  });
});

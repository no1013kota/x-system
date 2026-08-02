import { describe, expect, it } from "vitest";

import { ICON_PATHS } from "@/components/ui/icon-paths";

import { APP_NAVIGATION_ITEMS } from "./navigation-items";

describe("APP_NAVIGATION_ITEMS", () => {
  it("新デザインの7項目を表示順で定義する（T-M8-04）", () => {
    expect(APP_NAVIGATION_ITEMS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/app", label: "ホーム" },
      { href: "/app/news", label: "最新ニュース" },
      { href: "/app/posts", label: "投稿作成" },
      { href: "/app/schedule", label: "下書き・スケジュール" },
      { href: "/app/analytics", label: "分析・改善" },
      { href: "/app/ai-settings", label: "ベースmd" },
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

import { describe, expect, it } from "vitest";

import { APP_NAVIGATION_ITEMS } from "./navigation-items";

describe("APP_NAVIGATION_ITEMS", () => {
  it("defines the six SC-05 through SC-10 destinations in display order", () => {
    expect(APP_NAVIGATION_ITEMS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/app", label: "ホーム" },
      { href: "/app/news", label: "ニュース" },
      { href: "/app/posts", label: "投稿" },
      { href: "/app/schedule", label: "スケジュール" },
      { href: "/app/analytics", label: "分析" },
      { href: "/app/ai-settings", label: "AI設定" },
    ]);
  });

  it("does not duplicate a route or icon key", () => {
    expect(new Set(APP_NAVIGATION_ITEMS.map((item) => item.href)).size).toBe(6);
    expect(new Set(APP_NAVIGATION_ITEMS.map((item) => item.icon)).size).toBe(6);
  });
});

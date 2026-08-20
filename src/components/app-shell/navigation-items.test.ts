import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ICON_PATHS } from "@/components/ui/icon-paths";

import { APP_NAVIGATION_ITEMS } from "./navigation-items";

describe("APP_NAVIGATION_ITEMS", () => {
  it("ナビ項目を表示順で定義する（T-M8-04）", () => {
    // ラベルはヘッダーのパンくずにもなるので、**その画面のh1と一致していること**が要る
    // （T-M8-23。以前は `/app/ai-settings` のラベルが「アカウント.md」で本文の「AI設定」と食い違っていた）。
    expect(APP_NAVIGATION_ITEMS.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/app", label: "ホーム" },
      { href: "/app/news", label: "最新ニュース" },
      { href: "/app/posts", label: "投稿作成" },
      { href: "/app/schedule", label: "スケジュール" },
      { href: "/app/analytics", label: "投稿分析" },
      { href: "/app/invite", label: "友達招待" },
      { href: "/app/settings", label: "設定" },
      { href: "/prompt-templates", label: "プロンプト集" },
    ]);
  });

  it("ルートもアイコンも重複しない", () => {
    const count = APP_NAVIGATION_ITEMS.length;
    expect(new Set(APP_NAVIGATION_ITEMS.map((item) => item.href)).size).toBe(count);
    expect(new Set(APP_NAVIGATION_ITEMS.map((item) => item.icon)).size).toBe(count);
  });

  /**
   * **ラベルがその画面の h1 と一致している**（要件06 §2）。
   *
   * ラベルはヘッダーのパンくずにもなるので、ずれるとナビ・パンくず・本文で違う名前が出る。
   * **以前この検査はラベルの一覧を書き写すだけで h1 を1文字も読んでいなかった**（T-M8-141）ため、
   * `/app/news` がナビ「最新ニュース」／h1「ニュース」で**実際に食い違っていたのに緑だった**。
   * 各 route の `page.tsx` から h1 を読んで突き合わせる。
   */
  it("ラベルがその画面のh1と一致する（パンくずと本文で違う名前を出さない）", () => {
    const root = fileURLToPath(new URL("../../app/app/", import.meta.url));
    const checked: string[] = [];
    for (const item of APP_NAVIGATION_ITEMS) {
      // App Shellの外の公開ページは別ツリーから読む（/prompt-templates・T-M8-173）。
      if (!item.href.startsWith("/app")) {
        const publicFile = fileURLToPath(
          new URL(`../../app${item.href}/page.tsx`, import.meta.url),
        );
        const publicSource = readFileSync(publicFile, "utf8");
        const heading = /<h1[^>]*>([^<]+)<\/h1>/.exec(publicSource);
        expect(heading, `${item.href} に h1 が見つからない`).not.toBeNull();
        expect(heading![1].trim(), `${item.href} のナビラベルと h1 が違う`).toBe(item.label);
        checked.push(item.href);
        continue;
      }
      // `/app` → app/page.tsx、`/app/news` → app/news/page.tsx
      const rel = item.href.replace(/^\/app\/?/, "");
      const file = `${root}${rel ? `${rel}/` : ""}page.tsx`;
      const source = readFileSync(file, "utf8");
      const m = /<h1[^>]*>([^<]+)<\/h1>/.exec(source);
      expect(m, `${item.href} に h1 が見つからない（検査が空振りする）`).not.toBeNull();
      expect(m![1].trim(), `${item.href} のナビラベルと h1 が違う`).toBe(item.label);
      checked.push(item.href);
    }
    // **0件で緑にしない**（走査が壊れたら止める）。
    expect(checked.length).toBe(APP_NAVIGATION_ITEMS.length);
  });

  it("**アイコンが実在する**（生成済みの定義に含まれる）", () => {
    // 名前を打ち間違えると実行時に空のSVGになるだけで気付けない。ここで落とす。
    for (const item of APP_NAVIGATION_ITEMS) {
      expect(ICON_PATHS[item.icon], `${item.label} のアイコン ${item.icon}`).toBeTruthy();
    }
  });
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /**
     * **時刻は日本時間で走らせる**（T-M8-254・運営者の指示 2026-08-23）。
     *
     * 指定が無いと実行環境のTZになり、**手元（JST）では通るのにCI（UTC）では落ちる**
     * （逆も同じ）テストが書けてしまう。アプリの表示・日付境界はすべてJST基準なので、
     * テストも同じ基準で回して「手元で再現しない失敗」を作らない。
     * E2E（playwright.config.ts）は既に `timezoneId: "Asia/Tokyo"` を指定している。
     */
    env: { TZ: "Asia/Tokyo" },
    /**
     * 既定の5秒から引き上げる（T-M8-07）。
     *
     * `*.db.test.ts` は実DBへ何往復もし、env読み込みの都合で本文中に `await import()` を持つ。
     * 並列実行で負荷が上がると5秒を超え、**論理的な誤りが無いのに断続的に落ちていた**
     * （2026-08-02、4〜5回に1回・実測）。timeoutは「止まっている」ことの検出用で、
     * 「遅い」ことの検出用ではない。緑の経路では1msも余計にかからない。
     */
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // REQUIRE_DB=1 のときだけローカルSupabaseの到達性を先に検証する（skipの静かな緑を防ぐ）。
    globalSetup: ["./vitest.global-setup.ts"],
  },
});

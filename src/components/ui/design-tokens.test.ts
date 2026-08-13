import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 配色トークンの不変条件（F11）。
 *
 * ダークモードは持たない（PRD §3.2）。`.dark` パレットと参照0件のトークンは
 * 2026-08-11 に削除したが、**削除したこと自体を守るものが無い**と、shadcn の再生成や
 * コピペで戻ってくる。戻ると「色を触る人がライトとダークの2組を直す必要がある」と
 * 誤解し、片方だけ直して食い違う。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CSS = readFileSync(`${ROOT}src/app/globals.css`, "utf8");
// コメント内の言及で判定がぶれないようにする（landing-page.test.ts と同じ前処理）。
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("globals.css の配色トークン", () => {
  /**
   * **この1行を消してはいけない。**
   *
   * Tailwind v4 の `dark` バリアント既定（`@media (prefers-color-scheme: dark)`）を
   * クラス方式へ上書きしている。`.dark` を付ける箇所が無いので、結果として
   * `button.tsx` に残る shadcn 生成物の `dark:*` は発火しない。消すと既定へ戻り、
   * **OSをダークにしている閲覧者だけ** outline/ghost/destructive のボタンの枠と背景が
   * 暗くなり、ライト配色の画面の中で浮く。
   */
  it("dark バリアントはクラス方式のまま（消すと prefers-color-scheme 既定へ戻る）", () => {
    expect(
      RULES,
      "この行を消すと button.tsx の dark:* がOSダークの閲覧者だけで発火する",
    ).toContain("@custom-variant dark (&:is(.dark *));");
  });

  it("ダーク用パレットを持たない（ライト配色だけを提供する）", () => {
    expect(RULES).not.toMatch(/\.dark\s*\{/);
    expect(RULES).not.toContain("prefers-color-scheme");
  });

  it("参照0件だった shadcn 既定トークンが戻っていない", () => {
    // 戻ってきたら「使っていない色の2組目」を人が保守することになる。
    for (const token of [
      "--sidebar",
      "--color-sidebar",
      "--chart-1",
      "--color-chart-1",
      "--font-heading",
      "--motion-fast",
    ]) {
      expect(RULES, `${token} は参照0件のため削除した。使うなら参照とセットで足すこと`).not.toContain(
        token,
      );
    }
  });

  it("使用中のトークンは消していない（削除しすぎの検出）", () => {
    for (const token of ["--brand-gradient", "--shadow-pop", "--radius-card", "--page", "--ink"]) {
      expect(RULES, `${token} は使用中`).toContain(token);
    }
  });
});

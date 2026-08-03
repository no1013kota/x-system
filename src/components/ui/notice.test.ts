import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 危険色を1系統に保つ（T-M8-43）。
 *
 * 同じ「危険」の背景が2系統に分裂していた——アプリ内は `bg-danger-bg`（はっきりしたピンク）、
 * 認証フォームは `bg-destructive/10`（`danger-fg` の10%＝ほぼ白）。同じ深刻さが画面によって
 * 違う強さで出るため、利用者は色から深刻さを測れなかった。
 *
 * `bg-destructive/*` はボタン（`destructive` variant）の塗りにだけ許す。バナーは `Notice` を使う。
 */

const SRC = join(process.cwd(), "src");
const ALLOWED = new Set([
  // `destructive` variant のボタンの塗り。バナーではない。
  "src/components/ui/button.tsx",
  // 経緯を説明している文章（`Notice` 本体とこのテスト）。
  "src/components/ui/notice.tsx",
  "src/components/ui/notice.test.ts",
]);

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("危険色は1系統に保つ", () => {
  it("bg-destructive/* を使うのはボタンだけ（バナーは Notice を使う）", () => {
    const offenders = collect(SRC)
      .map((file) => file.slice(process.cwd().length + 1))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /bg-destructive\//.test(readFileSync(join(process.cwd(), rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});

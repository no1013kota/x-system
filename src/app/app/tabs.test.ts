/**
 * タブへのリンクが実在するタブを指していることの静的検査（T-M8-18）。
 *
 * **綴りを間違えても何も起きない。** `?tab=` の値が未知なら画面は先頭タブへ丸めるので、
 * リンクは200で開き、テストも通り、利用者だけが「押したのに違う画面が出た」に遭う。
 * 実際 API キー保存後の導線を `tab=ai-purpose` と書いていた（正しくは `purposes`）。
 *
 * リンク元は通知・エラーの導線・前提不足の案内など**画面から遠いところに散る**ので、
 * 個別の箇所を覚えるのではなく「リポジトリ内の `?tab=` はすべて実在する」を規則にする
 * （`ops/env-secret-usage.test.ts` と同じ考え方）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AI_SETTINGS_TABS } from "./ai-settings/tabs";
import { SETTINGS_TABS } from "./settings/tabs";

// 実行時のカレントディレクトリに依存させない（T-M8-51・R19）。
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ROOTS = ["src", "e2e", "scripts"].map((r) => join(REPO_ROOT, r));
const EXTENSIONS = [".ts", ".tsx", ".mjs"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (EXTENSIONS.some((e) => path.endsWith(e))) out.push(path);
  }
  return out;
}

/** `/app/<screen>?tab=<slug>` の literal を集める（テンプレート変数は対象外）。 */
function tabLinks(screen: string): { file: string; slug: string }[] {
  const pattern = new RegExp(`/app/${screen}\\?tab=([a-z0-9-]+)`, "g");
  const found: { file: string; slug: string }[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      // この検査自身の例示は対象外。
      if (file.endsWith("tabs.test.ts")) continue;
      const source = readFileSync(file, "utf8");
      // 失敗メッセージはリポジトリ相対で出す（絶対パスは環境ごとに変わって読みにくい）。
      const rel = relative(REPO_ROOT, file);
      for (const m of source.matchAll(pattern)) found.push({ file: rel, slug: m[1] });
    }
  }
  return found;
}

describe("AI設定のタブへのリンク", () => {
  const known = AI_SETTINGS_TABS.map(([slug]) => slug) as readonly string[];

  it("リンク元が1つ以上見つかる（検査そのものが空振りしていない）", () => {
    expect(tabLinks("ai-settings").length).toBeGreaterThan(0);
  });

  it("すべて実在するタブを指している", () => {
    const unknown = tabLinks("ai-settings").filter((l) => !known.includes(l.slug));
    expect(unknown.map((l) => `${l.file}: ?tab=${l.slug}`)).toEqual([]);
  });
});

describe("設定のタブへのリンク", () => {
  const known = SETTINGS_TABS.map(([slug]) => slug) as readonly string[];

  it("リンク元が1つ以上見つかる（検査そのものが空振りしていない）", () => {
    expect(tabLinks("settings").length).toBeGreaterThan(0);
  });

  it("すべて実在するタブを指している", () => {
    const unknown = tabLinks("settings").filter((l) => !known.includes(l.slug));
    expect(unknown.map((l) => `${l.file}: ?tab=${l.slug}`)).toEqual([]);
  });
});

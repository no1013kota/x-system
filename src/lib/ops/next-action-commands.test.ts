import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 運営者へ示すコマンドが**そのまま動く**ことを機械的に守る（T-M8-49）。
 *
 * `doctor` の `nextAction` は「いま何が壊れていて、次に何をすればよいか」を非エンジニアへ
 * 伝える唯一の出口である。ところが T-M8-35 で `stripe:portal:setup` に `--target` を必須化した際、
 * `portal-status.ts` の案内文が旧形式のまま残り、**運営者が言われた通り打つとエラーで止まる**
 * 状態になっていた（stagingで実際に踏んだ）。
 *
 * CLAUDE.md 原則2「原因が開発知識なしで辿れる」は、**示したコマンドがそのまま通ること**まで含む。
 * コマンド名の実在は機械的に検査できるので、人の記憶に任せない（原則3）。
 */

/** `process.cwd()` に依存しない（T-M8-51。サブディレクトリからの実行で落ちないように）。 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPTS: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
).scripts;

/**
 * 引数が無いと必ず失敗するスクリプト。**引数まで含めて案内する**必要がある。
 *
 * ここへ足すのは「既定を持たせず、指定漏れで止める」と決めたものだけ（取り違えの防止が目的で、
 * 既定を用意するのが誤りだったもの）。`stripe:portal:setup` は環境の取り違えでローカルを更新して
 * 「成功」と表示した事故（2026-08-04）を受けて `--target` を必須にした。
 */
const REQUIRED_FLAGS: Record<string, string> = {
  "stripe:portal:setup": "--target",
};

/** 運営者向けの文言を持つ範囲。 */
const SEARCH_DIRS = [join(ROOT, "src", "lib", "ops"), join(ROOT, "scripts")];

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    if (!entry.isFile()) return [];
    return /\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

/** 文字列中の `npm run <script>` とその後続（同じバッククォート内）を拾う。 */
function quotedCommands(source: string): { script: string; full: string }[] {
  return [...source.matchAll(/npm run ([a-z][a-z0-9:-]*)([^`"'\n]*)/g)].map((m) => ({
    script: m[1],
    full: `npm run ${m[1]}${m[2]}`,
  }));
}

describe("運営者へ示すコマンドはそのまま動く", () => {
  const found = SEARCH_DIRS.flatMap(collectFiles).flatMap((file) =>
    quotedCommands(readFileSync(file, "utf8")).map((c) => ({
      ...c,
      file: file.slice(ROOT.length),
    })),
  );

  it("検査対象のコマンドを実際に見つけている（空振りしていない）", () => {
    expect(found.length).toBeGreaterThan(3);
  });

  it("案内している npm script はすべて package.json に存在する", () => {
    const missing = found
      .filter((c) => !(c.script in SCRIPTS))
      .map((c) => `${c.file}: npm run ${c.script}`);
    expect(missing).toEqual([]);
  });

  it("引数が必須のスクリプトは、引数まで含めて案内している", () => {
    const incomplete = found
      .filter((c) => c.script in REQUIRED_FLAGS && !c.full.includes(REQUIRED_FLAGS[c.script]))
      .map((c) => `${c.file}: ${c.full}（${REQUIRED_FLAGS[c.script]} が無い）`);
    expect(incomplete).toEqual([]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `BadgeTone` を className へ流し込む書き方を機械的に禁止する（T-M8-36）。
 *
 * `STATUS_TONE[status]` の値は `"success"` のような **tone 名**であって CSS クラス名ではない。
 * これを `` className={`... ${STATUS_TONE[s]}`} `` と書くと `class="... success"` になり、
 * Tailwind に該当ユーティリティが無いので**色が一切当たらない**。M8で実際に起き、
 * Xアカウント設定の4状態（有効／要再連携／停止中／エラー）が全部同じ灰色枠になっていた。
 *
 * この型の退行は **typecheck も lint も E2E も通る**（型は `string` として妥当で、
 * DOM上は要素が存在する）。色が消えたことだけが症状なので、目で見るまで分からない。
 * 「tone は prop 経由のみ」という規約をここで固定する。
 *
 * 判定は「`BadgeTone` 型として宣言された識別子が `className` の中に現れないこと」。
 * tone から**クラス文字列を引いた**変数（`toneClass` 等）は別物なので対象にしない。
 */

/**
 * **`process.cwd()` に依存しない**（T-M8-51）。cwd 基準だとリポジトリ直下以外から
 * `vitest` を起動したとき（サブディレクトリ実行・エディタ統合）に必ず落ちる。
 * このファイル自身の位置からリポジトリ root を求める。
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");

function collectTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectTsx(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * `src/components/ui/*.tsx` が公開している tone 型の名前を集める（T-M8-51）。
 *
 * 以前は `BadgeTone` だけを見ていたため、**`Notice` 側で同じ無色化が起きても緑**だった。
 * 型名を列挙して自動で対象に含めれば、tone 型が増えても取りこぼしが構造的に消える。
 */
function toneTypeNames(): string[] {
  const names = readdirSync(join(SRC, "components", "ui"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .flatMap((entry) => [
      ...readFileSync(join(SRC, "components", "ui", entry.name), "utf8").matchAll(
        /export type (\w*Tone)\b/g,
      ),
    ])
    .map((match) => match[1]);
  return [...new Set(names)];
}

/** tone 型として宣言された識別子（tone のマップ・tone そのもの）。 */
function badgeToneIdentifiers(source: string, toneTypes: string[]): string[] {
  const alternation = toneTypes.join("|");
  return [
    ...source.matchAll(
      // `as const` / `satisfies` の形も拾う（型注釈が無い書き方で漏れないように）。
      new RegExp(
        `(?:const|let)\\s+(\\w+)\\s*(?::\\s*(?:Record<[^>]*(?:${alternation})\\s*>|(?:${alternation}))` +
          `|=[^;]*satisfies\\s+Record<[^>]*(?:${alternation})\\s*>)`,
        "g",
      ),
    ),
  ].map((match) => match[1]);
}

/** `className={ ... }` の中身を、波括弧の対応を数えて取り出す。 */
function classNameExpressions(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/className=\{/g)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    out.push(source.slice(start, index - 1));
  }
  return out;
}

const TONE_TYPES = toneTypeNames();

describe("tone は className へ展開しない", () => {
  it("検査対象の tone 型を自動で集めている（Badge だけを見て終わらない）", () => {
    // `Notice` を足したときに検査が追随しなかった穴を塞ぐ（T-M8-51）。
    expect(TONE_TYPES).toContain("BadgeTone");
    expect(TONE_TYPES).toContain("NoticeTone");
  });

  it("tone として宣言された識別子が className の中に現れない", () => {
    const offenders: string[] = [];
    for (const file of collectTsx(SRC)) {
      const source = readFileSync(file, "utf8");
      const toneNames = badgeToneIdentifiers(source, TONE_TYPES);
      if (toneNames.length === 0) continue;
      for (const expression of classNameExpressions(source)) {
        for (const name of toneNames) {
          if (new RegExp(`\\b${name}\\b`).test(expression)) {
            offenders.push(`${file.slice(ROOT.length)}: className に ${name} が入っている`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tone のマップを持つファイルを実際に検出できている（検査が空振りしていない）", () => {
    const withToneMaps = collectTsx(SRC).filter(
      (file) => badgeToneIdentifiers(readFileSync(file, "utf8"), TONE_TYPES).length > 0,
    );
    expect(withToneMaps.length).toBeGreaterThan(0);
  });
});

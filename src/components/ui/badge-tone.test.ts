import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

const SRC = join(process.cwd(), "src");

function collectTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectTsx(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** `BadgeTone` 型として宣言された識別子（tone のマップ・tone そのもの）。 */
function badgeToneIdentifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:const|let)\s+(\w+)\s*:\s*(?:Record<[^>]*BadgeTone\s*>|BadgeTone)/g),
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

describe("BadgeTone は className へ展開しない", () => {
  it("tone として宣言された識別子が className の中に現れない", () => {
    const offenders: string[] = [];
    for (const file of collectTsx(SRC)) {
      const source = readFileSync(file, "utf8");
      const toneNames = badgeToneIdentifiers(source);
      if (toneNames.length === 0) continue;
      for (const expression of classNameExpressions(source)) {
        for (const name of toneNames) {
          if (new RegExp(`\\b${name}\\b`).test(expression)) {
            offenders.push(`${file.slice(process.cwd().length + 1)}: className に ${name} が入っている`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tone のマップを持つファイルを実際に検出できている（検査が空振りしていない）", () => {
    const withToneMaps = collectTsx(SRC).filter(
      (file) => badgeToneIdentifiers(readFileSync(file, "utf8")).length > 0,
    );
    expect(withToneMaps.length).toBeGreaterThan(0);
  });
});

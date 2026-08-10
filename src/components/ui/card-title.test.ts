import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * カード見出しの見た目を1か所に保つ（T-M8-51）。
 *
 * T-M8-42 で `/app/**` の26箇所を `CardTitle` へ寄せたが、`components/app-shell/` と
 * ダイアログのタイトルに**同じクラス文字列の手書きが8箇所残っていた**（3規格の混在は
 * 解消したのに、単一の正には届いていなかった）。次にスケールを変えたときここだけ追随しない。
 *
 * `CardTitle` を使えない場所（Base UI の `AlertDialog.Title` など）は
 * `cardTitleClassName` を渡す。**リテラルの直書きだけを禁止する。**
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");
const OWNER = join(SRC, "components", "ui", "card.tsx");
const LITERAL = "text-[15px] font-bold text-ink";

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    // 定義元と、この検査自身（禁止する文字列を本文に含む）は対象外。
    return path === OWNER || entry.name === "card-title.test.ts" ? [] : [path];
  });
}

describe("カード見出しのクラス文字列は直書きしない", () => {
  it("cardTitleClassName / CardTitle 以外の場所にリテラルが無い", () => {
    const offenders = collect(SRC)
      .filter((file) => readFileSync(file, "utf8").includes(LITERAL))
      .map((file) => file.slice(ROOT.length));
    expect(
      offenders,
      "`CardTitle` を使うか、使えない場所（AlertDialog.Title 等）は `cardTitleClassName` を渡す",
    ).toEqual([]);
  });

  it("定義元にはリテラルがある（検査が空振りしていない）", () => {
    expect(readFileSync(OWNER, "utf8")).toContain(LITERAL);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * カードの見た目を1か所に保つ（T-M8-51）。
 *
 * T-M8-42/43/44 で見出し・バナー・チップは寄せたが、**器そのもの**は19箇所で手書きのままだった。
 * 器の角丸や枠を変えたときに追随しない。
 *
 * **`rounded-card border border-hairline bg-surface` 単体は禁止しない。** 調べると入力欄・トースト・
 * Popover・ラジオ・認証画面でも使われており、「白地＋hairline」という汎用の組み合わせを
 * たまたま共有しているだけ。カードの見た目を変えたときに入力欄の枠まで動くのは誤り。
 * **影まで含めた「カードそのもの」の並び**だけを対象にする。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");
const OWNER = join(SRC, "components", "ui", "card.tsx");
const SURFACE = "rounded-card border border-hairline bg-surface";
const SHADOW = "shadow-[var(--shadow-card)]";

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    return path === OWNER || entry.name === "card-surface.test.ts" ? [] : [path];
  });
}

/** 1つの className の中に「面」と「カードの影」が両方あるか。 */
function handWrittenCard(source: string): boolean {
  return [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].some((match) => {
    const value = match[1] ?? match[2] ?? "";
    return value.includes(SURFACE) && value.includes(SHADOW);
  });
}

describe("カードの見た目は直書きしない", () => {
  it("`Card` か `cardClassName` を使っている（面＋影の手書きが無い）", () => {
    const offenders = collect(SRC)
      .filter((file) => handWrittenCard(readFileSync(file, "utf8")))
      .map((file) => file.slice(ROOT.length));
    expect(
      offenders,
      "素の容器なら `<Card as=...>`、他のレイアウト指定と混ざるなら `cardClassName` を使う",
    ).toEqual([]);
  });

  it("定義元は面と影を持つ（検査が空振りしていない）", () => {
    const owner = readFileSync(OWNER, "utf8");
    expect(owner).toContain(SURFACE);
    expect(owner).toContain(SHADOW);
  });
});

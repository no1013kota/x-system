import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * アイコンを1系統に保ち、定義と使用を一致させる（T-M8-51）。
 *
 * 守るのは3つ。
 * 1. **`lucide-react` を戻さない。** T-M8-45 で撤去したが、`components.json` の
 *    `iconLibrary` は `lucide` のままなので、shadcn MCP で部品を足すと lucide を import した
 *    コードが入ってくる。撤去済みなので typecheck では落ちるが、**理由が読めるように**ここで止める。
 * 2. **`ICON_PATHS` に無い名前を渡さない。** 渡しても実行時に空のSVGになるだけで気付けない。
 *    `IconName` 型で静的に縛ってはいるが、生成をやり直したときの取りこぼしを機械で確かめる。
 * 3. **使っていないアイコンを溜めない。** 41個抽出のうち11個が誰にも使われず残っていた
 *    （棚卸しの手順が無かった）。増減のたびに人が数えなくてよい形にする。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");
const ICON_PATHS_FILE = join(SRC, "components", "ui", "icon-paths.ts");

function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    // 定義ファイルと、この検査自身（禁止する文字列を本文に含む）は対象外。
    if (path === ICON_PATHS_FILE || entry.name === "icon-source.test.ts") return [];
    return [path];
  });
}

const FILES = collectSources(SRC);
const ALL_SOURCE = FILES.map((file) => readFileSync(file, "utf8")).join("\n");

/** `icon-paths.ts` が定義しているアイコン名。 */
const DEFINED = new Set(
  [...readFileSync(ICON_PATHS_FILE, "utf8").matchAll(/^ {2}"([a-z0-9_]+)":/gm)].map((m) => m[1]),
);

describe("アイコンは1系統に保つ", () => {
  it("lucide-react を import していない（撤去済み・Icon を使う）", () => {
    const offenders = FILES.filter((file) =>
      /from "lucide-react"/.test(readFileSync(file, "utf8")),
    ).map((file) => file.slice(ROOT.length));
    expect(offenders, "アイコンは @/components/ui/icon の Icon を使う（ADR-0006 原則4）").toEqual(
      [],
    );
  });

  it("lucide-react が依存に戻っていない", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps)).not.toContain("lucide-react");
  });
});

describe("アイコンの定義と使用が一致している", () => {
  /**
   * `name="..."` のリテラル（動的に渡すものは対象外）。
   *
   * **`<Icon` タグの中だけを見る**（`[^>]*`）。以前は `[\s\S]*?` で、`name` を
   * 動的に渡すIcon（`name={cond ? "a" : "b"}`）があると、そこから先を走査し続けて
   * **無関係なファイルの `<input name="terms_version">` にマッチして落ちていた**。
   */
  const usedLiterals = new Set(
    [...ALL_SOURCE.matchAll(/<Icon\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]),
  );

  it("検査対象を実際に見つけている（空振りしていない）", () => {
    expect(DEFINED.size).toBeGreaterThan(10);
    expect(usedLiterals.size).toBeGreaterThan(10);
  });

  it("定義に無い名前を渡していない（渡すと空のSVGになるだけで気付けない）", () => {
    const missing = [...usedLiterals].filter((name) => !DEFINED.has(name));
    expect(missing).toEqual([]);
  });

  it("使われていないアイコンを残していない", () => {
    // ナビ項目のように変数経由で渡すものもあるため、**文字列としての出現**で判定する。
    const unused = [...DEFINED].filter((name) => !ALL_SOURCE.includes(`"${name}"`)).sort();
    expect(
      unused,
      "使わなくなったら scripts/generate-icons.mjs の ICON_NAMES から外して再生成する",
    ).toEqual([]);
  });
});

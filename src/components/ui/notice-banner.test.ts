import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * インラインバナーは `Notice` を使う（T-M8-52）。
 *
 * 45箇所が手書きで、padding 8種・枠線3種・文字サイズ4種に散っていた。**同じ重大度が画面によって
 * 違う強さで出る**ため、利用者は色から深刻さを測れない。T-M8-43 で危険色2系統を解消し、
 * ここで warn/info/success も寄せた。
 *
 * 判定は「**枠＋背景＋文字色の3点セット**」＝バナーの形をしているものだけ。
 * アイコンチップ（`rounded-full bg-info-bg`）や App Shell 上部の全幅バー（`border-b`）は
 * バナーではないので対象にしない。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");
const OWNER = join(SRC, "components", "ui", "notice.tsx");
const TONES = ["warn", "info", "success", "danger"] as const;

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    return path === OWNER || entry.name === "notice-banner.test.ts" ? [] : [path];
  });
}

describe("インラインバナーは Notice を使う", () => {
  it("枠＋背景＋文字色の3点セットを手書きしている場所が無い", () => {
    const offenders: string[] = [];
    for (const file of collect(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const tone of TONES) {
        if (source.includes(`border border-${tone}-fg/25`)) {
          offenders.push(`${file.slice(ROOT.length)}（${tone}）`);
        }
      }
    }
    expect(offenders, "`<Notice tone=...>` を使う（見出しを持つ領域は `as=\"section\"`）").toEqual(
      [],
    );
  });

  it("定義元は4つの tone を持つ（検査が空振りしていない）", () => {
    const owner = readFileSync(OWNER, "utf8");
    for (const tone of TONES) expect(owner).toContain(`border-${tone}-fg/25`);
  });
});

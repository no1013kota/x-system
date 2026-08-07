import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * タイプスケールを発散させない（T-M8-71）。
 *
 * 以前は 10〜48px の**21種**のフォントサイズが直書きされ、特に 12/12.5/13/13.5/14px の
 * 5段が約380箇所で併存していた（0.5px差は意図として区別できず、同じ「カードの説明文」に
 * 4サイズが混在）。本文系は globals.css のトークン3段に統一した:
 *   text-caption(12px) / text-body(13px) / text-sm(14px)
 * 15px未満の任意値（text-[12.5px] 等）を書くと、この検査が理由付きで止める。
 * 「どのサイズを使うべきか」を人の記憶に頼らせない（CLAUDE.md 原則3）。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");

/** 装飾として11pxを意図的に使うファイル（バッジ・未読数ドット・モバイル下部ナビのラベル）。 */
const ALLOW_11PX = new Set([
  "src/components/ui/badge.tsx",
  "src/components/app-shell/app-navigation.tsx",
  "src/components/app-shell/notification-bell.tsx",
]);

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (entry.name === "type-scale.test.ts" || entry.name === "icon-paths.ts") return [];
    return [path];
  });
}

describe("フォントサイズはトークンを使う", () => {
  const offenders: string[] = [];
  const files = collect(SRC);

  for (const file of files) {
    const rel = file.slice(ROOT.length);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
      const px = match[2] === "rem" ? Number(match[1]) * 16 : Number(match[1]);
      if (px >= 15) continue; // 見出し・表示用の大きめサイズは任意値を許す
      if (px === 11 && ALLOW_11PX.has(rel)) continue;
      offenders.push(`${rel}: ${match[0]}`);
    }
  }

  it("15px未満の任意値が無い（caption=12px / body=13px / text-sm=14px を使う）", () => {
    expect(offenders, "本文系は text-caption / text-body / text-sm のどれかにする").toEqual([]);
  });

  it("検査対象を実際に見ている（空振りしていない）", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("トークンが globals.css に定義されている", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    expect(css).toContain("--text-caption: 12px");
    expect(css).toContain("--text-body: 13px");
  });
});

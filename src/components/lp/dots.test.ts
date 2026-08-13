import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SLOT_DOT_CLASS, WEEKDAY_LABELS_LP } from "./dots";

/**
 * LPのドットの見た目を1箇所に保つ（R36）。
 *
 * ヒーローのモックと「できること」の図版は同じ意味のドットを描いているのに、
 * 対応表が3つのマップに別々のキー名で書かれていた。色や太さを直すと3箇所を直すことになり、
 * 1つ忘れると**同じドットが場所によって違う意味に見える**。
 * UIのクラスのドリフトは typecheck・lint・build のどれでも捕捉できないので、
 * ここでクラス集合そのものを固定する（`tab-nav.test.ts` と同じ考え方・R13c）。
 */

const LP_DIR = fileURLToPath(new URL("./", import.meta.url));

function lpSources(): { file: string; source: string }[] {
  return readdirSync(LP_DIR)
    .filter((name) => name.endsWith(".tsx"))
    .map((file) => ({ file, source: readFileSync(join(LP_DIR, file), "utf8") }));
}

describe("LPのドット", () => {
  it("意味と見た目の対応を固定する（●=そのまま投稿 ○=下書きまで）", () => {
    expect(SLOT_DOT_CLASS).toEqual({
      post: "bg-brand",
      draft: "border-[1.5px] border-brand",
      none: "border border-hairline",
    });
  });

  it("曜日は月曜始まりの7つ", () => {
    expect([...WEEKDAY_LABELS_LP]).toEqual(["月", "火", "水", "木", "金", "土", "日"]);
  });

  it("走査対象が見つかる（検査が空振りしていない）", () => {
    expect(lpSources().length).toBeGreaterThan(2);
  });

  /**
   * 対応表を各ファイルへ書き戻したら落とす。
   * 凡例（`bg-brand` を単体で使う説明用の点）は対象外なので、**マップの形**だけを見る。
   */
  it("ドットの対応表をコンポーネント側に持たない", () => {
    for (const { file, source } of lpSources()) {
      expect(
        source,
        `${file} がドットの対応表を自前で持っている。dots.ts を使ってください`,
      ).not.toMatch(/const dotClass\s*=/);
    }
  });

  it("曜日ラベルを各ファイルへ直書きしない", () => {
    for (const { file, source } of lpSources()) {
      expect(source, `${file} が曜日を直書きしている`).not.toContain('["月", "火", "水"');
    }
  });
});

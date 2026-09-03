import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOOP_TOTALS, formatMinutes } from "./loop-board";

/**
 * 図面板の見出し「手を動かす時間が、3h → 5m に。」は配列の合計から描く（page.tsx は直書きしない）。
 * 運営者指定の数字（2026-09-04・3h → 5m）が、内訳の足し引きで黙って変わらないようここで固定する。
 */
const TSX = readFileSync(
  fileURLToPath(new URL("./loop-board.tsx", import.meta.url)),
  "utf8",
);

describe("loop-board", () => {
  it("合計は運営者指定の 3h → 5m（内訳を編集して見出しがずれたらここで止まる）", () => {
    expect(LOOP_TOTALS).toEqual({
      before: "3h",
      after: "5m",
      beforeJa: "3時間",
      afterJa: "5分",
    });
  });

  it("formatMinutes は0分の端数を出さない（旧実装は 180 → \"3h 0m\" で見出しが崩れた）", () => {
    expect(formatMinutes(180)).toBe("3h");
    expect(formatMinutes(135)).toBe("2h 15m");
    expect(formatMinutes(5)).toBe("5m");
  });

  it("server component のまま・出現演出なし・合計の直書きなし", () => {
    expect(TSX).not.toContain('"use client"');
    expect(TSX).not.toMatch(/opacity-0|IntersectionObserver|animation-timeline/);
    // aria-label・figcaption に「3時間」「5分」を固定文字列で持たない（配列の足し引きで読み上げがずれる）。
    const withoutComments = TSX.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/["`（]3時間|["`（]5分/);
  });
});

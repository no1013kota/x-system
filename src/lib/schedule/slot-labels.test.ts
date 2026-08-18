import { describe, expect, it } from "vitest";

import {
  slotDescription,
  slotScheduleLabel,
  slotTimeLabel,
  WEEKDAY_LABELS,
} from "./slot-labels";

/**
 * スケジュール枠の表示文言（R38）。
 *
 * `aria-label` と `title` に同一のテンプレートが2度書かれており、ズレても
 * typecheck・lint・E2E のどれも落ちなかった（`.tsx` は単体テストの網に入らない）。
 * 移設にあたり、現在の出力をそのまま固定する。
 */

describe("WEEKDAY_LABELS", () => {
  /**
   * **0=日曜**。`schedule-enqueue.ts` の SQL が `extract(dow from now())` と
   * `weekdays` を突き合わせるため、ここを月曜始まりにすると
   * **画面の表示と実際に投稿される曜日が1つずれる**。
   */
  it("Postgres の dow に合わせて日曜始まり", () => {
    expect([...WEEKDAY_LABELS]).toEqual(["日", "月", "火", "水", "木", "金", "土"]);
    expect(WEEKDAY_LABELS[0]).toBe("日");
  });
});

describe("slotDescription", () => {
  const base = { pattern_name: "ニュース解説", theme: null as string | null, mode: "draft", enabled: true };

  it("型・モードを出す（下書きのみ）", () => {
    expect(slotDescription(base)).toBe("ニュース解説・下書きのみ");
  });

  it("自動投稿と停止中を出す", () => {
    expect(slotDescription({ ...base, mode: "auto" })).toContain("・自動投稿");
    expect(slotDescription({ ...base, enabled: false })).toContain("・停止中");
  });

  it("テーマがあれば添える", () => {
    expect(slotDescription({ ...base, theme: "ai" })).toContain("・テーマ ");
  });

  it("「その他」は分野として出さない（追加指示に書く意思表示のため）", () => {
    expect(slotDescription({ ...base, theme: "other" })).toBe(slotDescription(base));
  });

  it("未知の型はそのまま出す（表示が消えるより生の値を見せる）", () => {
    expect(slotDescription({ ...base, pattern_name: "p999" })).toContain("p999");
  });
});

describe("slotScheduleLabel / slotTimeLabel", () => {
  it("曜日を・でつなぎ、秒を落とした時刻を添える", () => {
    expect(slotScheduleLabel([1, 3, 5], "09:00:00")).toBe("月・水・金 09:00");
  });

  it("時刻は秒を出さない", () => {
    expect(slotTimeLabel("19:30:00")).toBe("19:30");
  });
});

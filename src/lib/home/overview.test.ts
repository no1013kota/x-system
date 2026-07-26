import { describe, expect, it } from "vitest";

import { scheduleOutlook, type OutlookSlot } from "./overview";

/** ホーム「次回の予定」の組み立て（要件06 §1・§10）。JSTの並び順と空状態の区別を確認する。 */

function slot(over: Partial<OutlookSlot> = {}): OutlookSlot {
  return {
    id: "s1",
    pattern: "p1",
    weekdays: [1],
    time_jst: "09:00",
    mode: "draft",
    image_enabled: false,
    enabled: true,
    ...over,
  };
}

// 2026-07-27 (月) 00:00 JST
const MONDAY_JST = new Date("2026-07-26T15:00:00.000Z");

describe("scheduleOutlook", () => {
  it("スロット未登録と全停止を区別する", () => {
    expect(scheduleOutlook([], MONDAY_JST)).toEqual({ kind: "no_slots" });
    expect(scheduleOutlook([slot({ enabled: false })], MONDAY_JST)).toEqual({
      kind: "all_disabled",
    });
  });

  it("次回が算出できないスロットしかなければ全停止として扱う", () => {
    const broken = [slot({ weekdays: [] }), slot({ id: "s2", time_jst: "99:99" })];
    expect(scheduleOutlook(broken, MONDAY_JST)).toEqual({ kind: "all_disabled" });
  });

  it("有効スロットの次回を早い順に並べ、停止中は除く", () => {
    const outlook = scheduleOutlook(
      [
        slot({ id: "later", time_jst: "18:00" }),
        slot({ id: "sooner", time_jst: "09:30", mode: "auto", image_enabled: true }),
        slot({ id: "off", time_jst: "07:00", enabled: false }),
      ],
      MONDAY_JST,
    );
    expect(outlook.kind).toBe("runs");
    if (outlook.kind !== "runs") return;
    expect(outlook.runs.map((r) => r.slotId)).toEqual(["sooner", "later"]);
    expect(outlook.runs[0]).toMatchObject({
      mode: "auto",
      imageEnabled: true,
      label: "7月27日(月) 9:30",
    });
  });

  it("件数を limit で絞る", () => {
    const slots = [1, 2, 3, 4].map((d, i) =>
      slot({ id: `s${i}`, weekdays: [d], time_jst: "09:00" }),
    );
    const outlook = scheduleOutlook(slots, MONDAY_JST, 2);
    expect(outlook.kind === "runs" && outlook.runs.length).toBe(2);
  });
});

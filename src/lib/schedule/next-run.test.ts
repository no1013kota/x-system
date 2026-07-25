import { describe, expect, it } from "vitest";

import { nextScheduleRun } from "./next-run";

/**
 * 次回実行の算出はJST基準（要件06 §2 SC-08）。UTCとの日跨ぎ・週跨ぎ・当日締め切り後の
 * 繰り越しを固定時刻で検証する。
 */
// 2026-07-26 は日曜。JST 08:00 = UTC 2026-07-25T23:00Z
const SUNDAY_JST_0800 = new Date("2026-07-25T23:00:00Z");

describe("nextScheduleRun", () => {
  it("同じ日のまだ来ていない時刻を返す", () => {
    const run = nextScheduleRun({ weekdays: [0], time_jst: "09:00" }, SUNDAY_JST_0800);
    expect(run?.label).toBe("7月26日(日) 9:00");
  });

  it("当日の時刻を過ぎていれば翌週の同じ曜日へ繰り越す", () => {
    // JST 08:00 時点で 07:30 は過ぎている
    const run = nextScheduleRun({ weekdays: [0], time_jst: "07:30" }, SUNDAY_JST_0800);
    expect(run?.label).toBe("8月2日(日) 7:30");
  });

  it("複数曜日のうち直近を選ぶ", () => {
    // 日曜08:00時点、月(1)と水(3) → 翌日の月曜
    const run = nextScheduleRun({ weekdays: [3, 1], time_jst: "09:00" }, SUNDAY_JST_0800);
    expect(run?.label).toBe("7月27日(月) 9:00");
  });

  it("JSTで日付が変わる時間帯でも正しい日を返す", () => {
    // UTC 2026-07-26T16:30Z = JST 2026-07-27(月) 01:30
    const lateNight = new Date("2026-07-26T16:30:00Z");
    const run = nextScheduleRun({ weekdays: [1], time_jst: "09:00" }, lateNight);
    expect(run?.label).toBe("7月27日(月) 9:00");
  });

  it("月をまたぐ場合も日付表記が正しい", () => {
    // JST 2026-07-31(金) 12:00 の次の土曜 = 8月1日
    const endOfMonth = new Date("2026-07-31T03:00:00Z");
    const run = nextScheduleRun({ weekdays: [6], time_jst: "10:00" }, endOfMonth);
    expect(run?.label).toBe("8月1日(土) 10:00");
  });

  it("曜日が空、または時刻が不正なら null", () => {
    expect(nextScheduleRun({ weekdays: [], time_jst: "09:00" }, SUNDAY_JST_0800)).toBeNull();
    expect(nextScheduleRun({ weekdays: [0], time_jst: "bogus" }, SUNDAY_JST_0800)).toBeNull();
    expect(nextScheduleRun({ weekdays: [0], time_jst: "25:00" }, SUNDAY_JST_0800)).toBeNull();
  });

  it("秒付きの time_jst も扱える", () => {
    const run = nextScheduleRun({ weekdays: [0], time_jst: "09:30:00" }, SUNDAY_JST_0800);
    expect(run?.label).toBe("7月26日(日) 9:30");
  });
});

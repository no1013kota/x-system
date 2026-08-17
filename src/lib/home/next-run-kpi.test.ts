import { describe, expect, it } from "vitest";

import { nextRunKpi } from "./next-run-kpi";

/** 予定が無い理由を書き分ける（空欄にすると原因が分からない）。 */
describe("nextRunKpi", () => {
  it("Xアカウント未連携（outlookがnull）は理由を出す", () => {
    expect(nextRunKpi(null)).toEqual({
      label: null,
      note: "Xアカウントを連携すると表示されます",
    });
  });

  it("スロット未作成と全停止を書き分ける", () => {
    expect(nextRunKpi({ kind: "no_slots" }).note).toBe("スケジュールが未設定です");
    expect(nextRunKpi({ kind: "all_disabled" }).note).toBe("すべてのスケジュールが停止中です");
  });

  it("予定があれば時刻を大きく、日付とパターンを添える", () => {
    const kpi = nextRunKpi({
      kind: "runs",
      runs: [
        {
          slotId: "s1",
          patternName: "ノウハウ・ハウツー",
          mode: "draft",
          imageEnabled: false,
          label: "7月27日(月) 9:00",
          at: "2026-07-27T00:00:00Z",
        },
      ],
    });
    expect(kpi.label).toBe("9:00");
    expect(kpi.note).toContain("7月27日(月)");
    expect(kpi.note).toContain("下書きまで");
  });

  it("自動投稿と下書きまでを区別する", () => {
    const base = {
      slotId: "s1",
      patternName: "ニュース解説",
      imageEnabled: false,
      label: "8月1日(土) 18:00",
      at: "2026-08-01T09:00:00Z",
    };
    expect(nextRunKpi({ kind: "runs", runs: [{ ...base, mode: "auto" }] }).note).toContain(
      "自動投稿",
    );
    expect(nextRunKpi({ kind: "runs", runs: [{ ...base, mode: "draft" }] }).note).toContain(
      "下書きまで",
    );
  });

  it("runs が空でも落ちない", () => {
    expect(nextRunKpi({ kind: "runs", runs: [] })).toEqual({
      label: null,
      note: "直近の予定はありません",
    });
  });
});

import type { ScheduleOutlook } from "./overview";

/**
 * 「次回の自動実行」KPI（T-M8-05）。
 *
 * **予定が無い理由を書き分ける**（CLAUDE.md 原則1）。空欄にすると、スロットを作っていないのか、
 * 作ったが全部止めているのか、単に今日はもう無いのかが分からない。
 */
export function nextRunKpi(outlook: ScheduleOutlook | null): {
  label: string | null;
  note: string | null;
} {
  if (!outlook) return { label: null, note: "Xアカウントを連携すると表示されます" };
  if (outlook.kind === "no_slots") {
    return { label: null, note: "スケジュールが未設定です" };
  }
  if (outlook.kind === "all_disabled") {
    return { label: null, note: "すべてのスケジュールが停止中です" };
  }
  const next = outlook.runs[0];
  if (!next) return { label: null, note: "直近の予定はありません" };

  // ラベルは「7月27日(月) 9:00」形式。KPIには時刻だけを大きく出し、日付は下へ添える。
  const time = next.label.match(/(\d{1,2}:\d{2})\s*$/)?.[1] ?? next.label;
  const date = next.label.replace(/\s*\d{1,2}:\d{2}\s*$/, "").trim();
  const pattern = next.patternName ?? "パターン未設定";
  const mode = next.mode === "auto" ? "自動投稿" : "下書きまで";
  return { label: time, note: `${date}・${pattern}（${mode}）` };
}

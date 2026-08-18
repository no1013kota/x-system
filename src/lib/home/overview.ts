import { nextScheduleRun } from "../schedule/next-run";

/**
 * ホーム（SC-05）の「次回の予定」を組み立てる純関数（要件06 §1・§10）。有効スロットの次回実行を
 * 早い順に並べ、スロット未登録・全停止を区別して返す。DBもDateも隠さないので単体テストできる。
 */

export interface UpcomingRunView {
  slotId: string;
  /** パターンの表示名。削除済みなら null（**内部IDは出さない**・T-M8-129 U3）。 */
  patternName: string | null;
  /** `auto`（自動投稿）／`draft`（下書き作成）。 */
  mode: string;
  imageEnabled: boolean;
  /** 「7月27日(月) 9:00」形式のJST表示。 */
  label: string;
  at: string;
}

export type ScheduleOutlook =
  | { kind: "runs"; runs: UpcomingRunView[] }
  /** スロットを1件も作っていない。 */
  | { kind: "no_slots" }
  /** スロットはあるが、有効なものが無い（すべて停止中／曜日・時刻が不正）。 */
  | { kind: "all_disabled" };

export interface OutlookSlot {
  id: string;
  pattern_name: string | null;
  weekdays: number[];
  time_jst: string;
  mode: string;
  image_enabled: boolean;
  enabled: boolean;
}

export function scheduleOutlook(
  slots: OutlookSlot[],
  from: Date = new Date(),
  limit = 3,
): ScheduleOutlook {
  if (slots.length === 0) return { kind: "no_slots" };
  const runs: UpcomingRunView[] = [];
  for (const slot of slots) {
    if (!slot.enabled) continue;
    const next = nextScheduleRun(slot, from);
    if (!next) continue;
    runs.push({
      slotId: slot.id,
      patternName: slot.pattern_name,
      mode: slot.mode,
      imageEnabled: slot.image_enabled,
      label: next.label,
      at: next.at.toISOString(),
    });
  }
  if (runs.length === 0) return { kind: "all_disabled" };
  runs.sort((a, b) => a.at.localeCompare(b.at));
  return { kind: "runs", runs: runs.slice(0, limit) };
}

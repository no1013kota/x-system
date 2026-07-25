/**
 * スケジュールスロットの「次回実行日時」をJSTで算出する（要件06 §2 SC-08）。
 * 画面に「次にいつ何が投稿されるか」を出すための純関数。DBは変更しない。
 *
 * `weekdays` は 0=日〜6=土（`schedule_slots.weekdays`）、`time_jst` は "HH:MM[:SS]"。
 * 判定・表示はすべてJST基準で行う（サーバ/クライアントのTZに依存しない）。
 */

const MS_PER_DAY = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 与えた時刻をJSTの暦要素へ分解する。 */
function jstParts(at: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minutesOfDay: number;
} {
  const shifted = new Date(at.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** "HH:MM[:SS]" を0時からの分に直す。不正値は null。 */
function parseTimeJst(timeJst: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(timeJst);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export interface NextRun {
  /** 実行時刻（UTC基準のDate。表示はJSTで行う）。 */
  at: Date;
  /** 「7月27日(月) 9:00」形式のJST表示。 */
  label: string;
}

/**
 * 次回実行を返す。曜日が空、時刻が不正なら null。`from` 以降で最も近い該当時刻を選ぶ
 * （同日ちょうどの時刻は「次回」に含めない＝すでに開始済みのため）。
 */
export function nextScheduleRun(
  slot: { weekdays: number[]; time_jst: string },
  from: Date = new Date(),
): NextRun | null {
  const minutesOfDay = parseTimeJst(slot.time_jst);
  const weekdays = [...new Set(slot.weekdays)].filter((d) => d >= 0 && d <= 6);
  if (minutesOfDay === null || weekdays.length === 0) return null;

  const now = jstParts(from);
  for (let ahead = 0; ahead <= 7; ahead++) {
    const weekday = (now.weekday + ahead) % 7;
    if (!weekdays.includes(weekday)) continue;
    if (ahead === 0 && minutesOfDay <= now.minutesOfDay) continue;
    // JSTの (今日 + ahead日) の指定時刻 → UTC のDateへ戻す
    const jstMidnightUtcMs =
      Date.UTC(now.year, now.month - 1, now.day) - JST_OFFSET_MS + ahead * MS_PER_DAY;
    const at = new Date(jstMidnightUtcMs + minutesOfDay * 60_000);
    const parts = jstParts(at);
    const hour = Math.floor(minutesOfDay / 60);
    const minute = minutesOfDay % 60;
    return {
      at,
      label: `${parts.month}月${parts.day}日(${WEEKDAY_LABELS[parts.weekday]}) ${hour}:${String(minute).padStart(2, "0")}`,
    };
  }
  return null;
}

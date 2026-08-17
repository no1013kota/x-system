import { OTHER_POST_THEME, postThemeLabel } from "@/lib/post/post-theme";

/**
 * スケジュールの枠を言葉にする（R38）。
 *
 * 週間表のセルは `aria-label` と `title` に**完全に同一のテンプレート**を2度書いていた。
 * 支援技術向けの名前と、マウスで見える補足がズレても typecheck・lint・E2E のどれも落ちない。
 * `.tsx` は単体テストの網（`environment: node` / `include: src/**\/*.test.ts`）に入らないため、
 * 画面に置いたままでは守れない。
 */

/**
 * 週の並び。**0=日曜**（Postgres の `extract(dow ...)` に合わせる）。
 *
 * `schedule-enqueue.ts` の SQL が `extract(dow from now())` と `weekdays` を突き合わせるため、
 * ここを月曜始まりにすると**画面の表示と実際に投稿される曜日が1つずれる**。
 * LPの図版（`components/lp/dots.ts` の `WEEKDAY_LABELS_LP`）は見た目だけの月曜始まりで、別物。
 */
export const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * パターンの表示名。**内部ID（`p1`）は出さない**（要件06 §1.0・T-M8-129 U3）。
 * パターンが削除されると `pattern_name` は null になる（枠は停止して設定は残る）。
 * そのときは「パターン未設定」と書く——空欄にすると設定漏れなのか削除なのか分からない。
 */
export function patternLabel(patternName: string | null): string {
  return patternName ?? "パターン未設定";
}

/** `09:00:00` → `09:00`（秒は画面に出さない）。 */
export function slotTimeLabel(timeJst: string): string {
  return timeJst.slice(0, 5);
}

/** 「月・水・金 09:00」。曜日は保存順のまま出す（並べ替えは呼び出し側の責務）。 */
export function slotScheduleLabel(weekdays: readonly number[], timeJst: string): string {
  return `${weekdays.map((d) => WEEKDAY_LABELS[d]).join("・")} ${slotTimeLabel(timeJst)}`;
}

/**
 * セルの説明。`aria-label` と `title` の**両方がこれを使う**（ズレを作らない）。
 *
 * 「その他」のテーマは追加指示に書く意思表示なので、分野としては出さない。
 */
export function slotDescription(slot: {
  pattern_name: string | null;
  theme?: string | null;
  mode: string;
  enabled: boolean;
}): string {
  const theme =
    slot.theme && slot.theme !== OTHER_POST_THEME ? `・テーマ ${postThemeLabel(slot.theme)}` : "";
  const mode = slot.mode === "auto" ? "自動投稿" : "下書きのみ";
  const stopped = slot.enabled ? "" : "・停止中";
  return `${patternLabel(slot.pattern_name)}${theme}・${mode}${stopped}`;
}

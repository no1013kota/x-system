/**
 * スケジュール枠の保存前チェック（R38）。
 *
 * 「曜日0件 → テーマ未選択 → auto かつ未同意」の順で見る判定が `.tsx` の中にあり、
 * サーバー側の正本（`schedule-slots.ts` の `weekdays.min(1)` と `z.enum(POST_THEME_IDS)`）を
 * 手で写していた。`.tsx` は単体テストの網に入らないため、この分岐を壊しても
 * **E2Eで踏んだ経路以外はすべて緑のまま通る**（`draft-actions.ts` を切り出したのと同じ構図）。
 *
 * T-M8-37 の「どの項目が悪いか分からないエラーを出さない」という要求が、
 * ここまで機械検査に載っていなかった。判定だけを返し、画面の状態更新は呼び出し側に残す。
 */

export interface SlotFormValues {
  weekdays: number[];
  theme: string | null;
  mode: string;
  /** 空文字は「パターンを追加」中＝未確定（T-M8-203）。 */
  pattern_id: string;
}

export interface SlotFormVerdict {
  /** 画面に出す理由（問題なければ null）。 */
  error: string | null;
  /** 保存の前に自動実行の同意を取る必要があるか。 */
  needsConsent: boolean;
}

/**
 * 保存してよいかを判定する。
 *
 * **順序を変えないこと。** 曜日→テーマ→同意の順に見ることで、利用者は上から順に
 * 埋めれば必ず保存できる（同意modalを先に出すと、直した後にまた別のエラーが出る）。
 */
export function validateSlotForm(
  values: SlotFormValues,
  options: { consented: boolean },
): SlotFormVerdict {
  if (values.weekdays.length === 0) {
    return { error: "曜日を1つ以上選択してください。", needsConsent: false };
  }
  // パターン未選択＝「パターンを追加」中（T-M8-203。追加を確定するかキャンセルするまで保存できない）。
  if (!values.pattern_id) {
    return {
      error: "パターンを選択してください（追加中なら「追加」か「キャンセル」で確定してください）。",
      needsConsent: false,
    };
  }
  // テーマは必須（`schedule-slots.ts` の `z.enum(POST_THEME_IDS)`）。ここで止めないと
  // 「入力内容を確認してください」という**どの項目が悪いか分からない**エラーになる（T-M8-37）。
  if (!values.theme) {
    return { error: "テーマを選択してください。", needsConsent: false };
  }
  // mode=auto かつ未同意なら、保存前に同意を取る（要件06 §3.5）。
  if (values.mode === "auto" && !options.consented) {
    return { error: null, needsConsent: true };
  }
  return { error: null, needsConsent: false };
}

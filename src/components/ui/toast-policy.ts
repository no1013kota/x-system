/**
 * トーストの扱いの判断（T-M8-15）。**描画から切り離してテストできるようにする**。
 *
 * このリポジトリの単体テストは `environment: node` でDOMを持たない。判断をコンポーネントの
 * 中に埋めると「成功と失敗で扱いが違う」という肝心の決まりを固定できないため、ここへ出す。
 */

export type ToastTone = "success" | "error";

/** 成功トーストが自動で消えるまで（デザイン §T-1）。 */
export const AUTO_DISMISS_MS = 5000;

/**
 * 読み上げ種別。
 * - 成功: `status`（polite）— 作業を邪魔しない。
 * - 失敗: `alert`（assertive）— 割り込んででも伝える。
 */
export function toastRole(tone: ToastTone): "status" | "alert" {
  return tone === "success" ? "status" : "alert";
}

/**
 * 自動で消してよいか。
 * **失敗は消さない。** 見逃すと利用者は「操作できた」と誤解する（CLAUDE.md 原則1）。
 */
export function toastShouldAutoDismiss(tone: ToastTone): boolean {
  return tone === "success";
}

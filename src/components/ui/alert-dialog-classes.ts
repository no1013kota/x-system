/**
 * 確認ダイアログ（`AlertDialog`）の見た目の**単一の正本**（T-M8-134）。
 *
 * 7箇所が同じclass文字列を手で書いており、**1箇所だけ `z-50` が抜けていた**。
 * ヘッダーは `sticky z-20` なので、抜けると暗幕がヘッダーの下へ回り
 * **ヘッダーだけ明るいまま**になる。HTTPも通り要素も存在するので、
 * ブラウザで重なりを実測しない限り気付けない（2026-08-18に運営者が発見）。
 *
 * 「`z-50` を忘れない」という手順を人間の記憶に預けない（CLAUDE.md 原則3）。
 * 新しいダイアログはこの定数を使う。
 */

/** 暗幕。画面全体（ヘッダー・サイドバー含む）を覆う。 */
export const alertDialogBackdropClassName = "fixed inset-0 z-50 bg-black/55";

const POPUP_BASE =
  "fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 " +
  "rounded-modal border border-hairline bg-surface p-6 shadow-[var(--shadow-modal)] outline-none";

/**
 * 本体。`size` は内容量で選ぶ（既定は確認文＋ボタン2つに合う `md`）。
 *
 * **幅は文字列を繋がず、丸ごと書いた候補から選ぶ。** Tailwind はソースを文字列として
 * 走査するので、`max-w-${size}` のように組み立てるとclassが生成されず幅が効かない。
 */
export function alertDialogPopupClassName(size: "md" | "lg" = "md"): string {
  return `${POPUP_BASE} ${size === "lg" ? "max-w-lg" : "max-w-md"}`;
}

/**
 * 生成物に付く警告コードと、**自動投稿を止めるかどうか**の区別（F2）。
 *
 * `generation-validation.ts` は検証本体（NG語照合・スレッド上限・文字数計測）を持つため、
 * 画面側（client component）から値として読むと検証ロジックまで引き込む。ここは
 * **コードの一覧と分類だけを持つ依存ゼロのモジュール**で、画面と検証の両方から読める。
 *
 * 正本はここ。`generation-validation.ts` は re-export するだけにして、既存の import 元を壊さない。
 */

export const WARNING = {
  lengthExceeded: "length_exceeded",
  cashtagMultiple: "cashtag_multiple",
  ngWord: "ng_word",
  sourceMissing: "source_missing",
  injectionSuspected: "injection_suspected",
  /** 読みやすさの目標（加重240）を超えたまま（T-M7-41）。品質の目印で、投稿は止めない。 */
  lengthOverTarget: "length_over_target",
  /** ポスト数の上限を超えたため途中のポストを落とした（T-M7-41）。投稿は止めない。 */
  postCountTrimmed: "post_count_trimmed",
} as const;

export type WarningCode = (typeof WARNING)[keyof typeof WARNING];

/**
 * これらの警告があるポストを含む下書きは自動投稿しない（要件06 §4.3）。
 *
 * `lengthOverTarget` と `postCountTrimmed` は**含めない**。読みやすさの目標や長さの調整で
 * 予約投稿が黙って止まる方が害が大きい（運営者は下書き画面で気付ければよい）。
 */
export const AUTO_POST_BLOCKING_WARNINGS: ReadonlySet<string> = new Set<string>([
  WARNING.lengthExceeded,
  WARNING.cashtagMultiple,
  WARNING.ngWord,
  WARNING.sourceMissing,
  WARNING.injectionSuspected,
]);

/**
 * この下書きの警告が**自動投稿を止めるものを含むか**（F2）。
 *
 * 以前は「警告が1つでもあれば自動投稿は停止します」と画面に出していたが、
 * `lengthOverTarget` / `postCountTrimmed` と画像失敗は止めない設計なので、
 * **止まっていない投稿を止まったと伝えていた**（CLAUDE.md 原則1の逆）。
 */
export function blocksAutoPost(warnings: readonly string[]): boolean {
  return warnings.some((code) => AUTO_POST_BLOCKING_WARNINGS.has(code));
}

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * インラインの通知バナー（T-M8-43）。
 *
 * **同じ重大度は同じ強さで出す。** M8の監査で、同じ「危険」の背景が2系統に分裂していた——
 * アプリ内は `bg-danger-bg`（`#ffd9dc`・はっきりしたピンク）、認証フォームは
 * `bg-destructive/10`（`danger-fg` の10%＝ほぼ白）。同じ深刻さが画面によって違う強さで出るため、
 * 利用者は色から深刻さを測れなかった。padding も8種、枠線も3種、文字サイズも4種に散っていた。
 *
 * **トーストとの使い分け**（要件06 §2.1）: 操作の結果はトースト。ここに残すのは
 * (a) 入力検証、(b) ボタンを伴う案内、(c) 恒常表示・画面状態の3種類。
 * トーストは1回出て消えるので、リロードや画面復帰で失われてはいけないものはこちら。
 *
 * `tone` の意味づけは `Badge` の TONES と揃える（同じ色が別の意味で使われないように）。
 */
const TONES = {
  /** 成功・完了。 */
  success: "border-success-fg/25 bg-success-bg text-success-fg",
  /** 情報・進行中。 */
  info: "border-info-fg/25 bg-info-bg text-info-fg",
  /** 注意。放置すると困るが今は動く。 */
  warn: "border-warn-fg/25 bg-warn-bg text-warn-fg",
  /** 危険・失敗。 */
  danger: "border-danger-fg/25 bg-danger-bg text-danger-fg",
} as const;

export type NoticeTone = keyof typeof TONES;

/**
 * `as` で要素を選べる（既定は `div`）。**見出しを持つ通知は `section`** にする——
 * `div` にすると `aria-labelledby` の指す landmark が消える（`Card` と同じ考え方・T-M8-52）。
 */
export function Notice({
  as: Tag = "div",
  className,
  tone = "info",
  ...props
}: ComponentProps<"div"> & { as?: "div" | "section" | "p"; tone?: NoticeTone }) {
  return (
    <Tag
      className={cn(
        "rounded-card border px-4 py-3 text-[13px] leading-6",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

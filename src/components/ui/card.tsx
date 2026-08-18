import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * カード（T-M8-03）。新デザインの基本の器。
 *
 * 白地・1px hairline・角丸8px・内側padding 16〜20px（デザイン §形状・余白）。
 * これまで各画面が `rounded-xl border bg-background p-4` のような組み合わせを直書きしており、
 * 値が少しずつ違っていた。**器はここへ集約する**（保守運用のため）。
 */
/**
 * `as` で要素を選べる（既定は `div`）。見出しを持つ独立した領域は `section` にする——
 * `div` にすると landmark が消え、支援技術からもテストからも「1つのまとまり」として
 * 扱えなくなる（T-M8-41）。
 */
/**
 * カードの見た目（T-M8-51）。`Card` を使えない場所（`page-state.tsx` の状態カードなど）と共有する。
 *
 * **`rounded-card border border-hairline bg-surface` 単体は寄せない。** 調べると入力欄・トースト・
 * Popover・ラジオ・認証画面でも使われており、これらは「白地＋hairline」という汎用の組み合わせを
 * たまたま共有しているだけ。カードの見た目を変えたときに入力欄の枠まで動くのは誤り。
 * **影まで含めた「カードそのもの」の並びだけ**を単一の正とする（`card-surface.test.ts` が直書きを禁止）。
 */
export const cardClassName =
  "rounded-card border border-hairline bg-surface shadow-[var(--shadow-card)]";

export function Card({
  as: Tag = "div",
  className,
  ...props
}: ComponentProps<"div"> & { as?: "div" | "section" | "article" }) {
  return (
    <Tag
      className={cn(cardClassName, className)}
      {...props}
    />
  );
}

/** カードの見出し行。タイトルと右側のアクションを両端に置く。 */
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3", className)}
      {...props}
    />
  );
}

/**
 * カードのタイトル。既定は `h2`。
 *
 * **見出しはロールを保つ**（`as` で `h1`〜`h3` を選ぶ）。`p` に置き換えると
 * `getByRole("heading")` で拾えなくなり、支援技術からも見出しとして扱われない。
 */
/**
 * カード見出しの見た目（T-M8-51）。**ダイアログのタイトルなど、`CardTitle` を使えない場所と共有する。**
 * 同じクラス文字列を手書きすると、次にスケールを変えたときに追随しない
 * （`card-title.test.ts` が直書きを禁止する）。
 */
export const cardTitleClassName = "text-[15px] font-bold text-ink";

/**
 * App画面の見出し（`h1`）のクラス（T-M8-146）。
 *
 * **7箇所へ逐語で直書きされていた。** `cardTitleClassName` と同型の集約が h1 だけ
 * 抜けていた状態で、字送りや色を変えると画面ごとに取り残しが出る。
 * ナビ・パンくずと同じ名前を出す見出しなので、見た目も1か所で決める
 * （文言の一致は `navigation-items.test.ts` が別に検査する）。
 */
export const pageTitleClassName = "text-[20px] font-bold tracking-tight text-ink";

export function CardTitle({
  as: Tag = "h2",
  className,
  ...props
}: ComponentProps<"h2"> & { as?: "h1" | "h2" | "h3" }) {
  return <Tag className={cn(cardTitleClassName, className)} {...props} />;
}

/** カードの本体。見出しが無いカードでは単体で使ってよい。 */
export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pt-4 pb-5", className)} {...props} />;
}

/** 見出しの下の補足文。 */
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-body leading-5 text-ink-2", className)} {...props} />;
}

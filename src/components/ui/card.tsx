import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * カード（T-M8-03）。新デザインの基本の器。
 *
 * 白地・1px hairline・角丸8px・内側padding 16〜20px（デザイン §形状・余白）。
 * これまで各画面が `rounded-xl border bg-background p-4` のような組み合わせを直書きしており、
 * 値が少しずつ違っていた。**器はここへ集約する**（保守運用のため）。
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline bg-surface shadow-[var(--shadow-card)]",
        className,
      )}
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
export function CardTitle({
  as: Tag = "h2",
  className,
  ...props
}: ComponentProps<"h2"> & { as?: "h1" | "h2" | "h3" }) {
  return <Tag className={cn("text-[15px] font-bold text-ink", className)} {...props} />;
}

/** カードの本体。見出しが無いカードでは単体で使ってよい。 */
export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pt-4 pb-5", className)} {...props} />;
}

/** 見出しの下の補足文。 */
export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[12.5px] leading-5 text-ink-2", className)} {...props} />;
}

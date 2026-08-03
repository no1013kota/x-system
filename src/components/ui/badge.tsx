import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * バッジ・チップ（T-M8-03）。状態やカテゴリを短い語で示す小片。
 *
 * 色は意味で選ぶ（デザイン §カラー）。**見た目の好みで選ばない**——同じ色が別の意味で
 * 使われると、利用者は色から状態を読み取れなくなる。
 */
const TONES = {
  /** 既定。分類・補助情報。 */
  neutral: "bg-black/[0.04] text-ink-2",
  /** キーカラー。選択中・自分のプラン・自動実行など「いま効いている」もの。 */
  brand: "bg-brand-subtle text-brand",
  /** 成功・完了・有効。 */
  success: "bg-success-bg text-success-fg",
  /** 情報・進行中。 */
  info: "bg-info-bg text-info-fg",
  /** 注意。放置すると困るが今は動く。 */
  warn: "bg-warn-bg text-warn-fg",
  /** 危険・失敗・破壊的操作。 */
  danger: "bg-danger-bg text-danger-fg",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * ニュース分野のチップ。分野ごとに固定の配色（デザイン §カラー）。
 *
 * **取得している3分野以外も定義を残す**。過去に保存された記事や、利用者が以前
 * 選んでいた分野の表示で使われるため（T-M7-55 で取得は3分野へ絞ったが、
 * 既存データは消していない）。
 */
export const NEWS_CATEGORY_CHIP: Record<string, string> = {
  ai: "bg-info-bg text-info-fg",
  web3: "bg-brand-subtle text-brand",
  investment: "bg-success-bg text-success-fg",
  business: "bg-[#eef1f9] text-[#4c71ba]",
  business_ops: "bg-warn-bg text-warn-fg",
  sns: "bg-[#fdeee6] text-[#c94a06]",
};

export function CategoryChip({
  category,
  className,
  ...props
}: ComponentProps<"span"> & { category: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        NEWS_CATEGORY_CHIP[category] ?? NEWS_CATEGORY_CHIP.ai,
        className,
      )}
      {...props}
    />
  );
}

import type { IconName } from "@/components/ui/icon";

/**
 * 左サイドバーのナビ項目（T-M8-04）。
 *
 * 新デザインは7項目（旧6項目）。**URLは変えていない** ——「ベースmd」と「設定」は
 * 既存のルート／タブへそのまま繋ぐ。ナビの見え方だけをデザインへ合わせる。
 *
 * `icon` は `components/ui/icon.tsx` の Material Symbols 名。
 */
export const APP_NAVIGATION_ITEMS = [
  { href: "/app", icon: "output", label: "ホーム" },
  { href: "/app/news", icon: "newspaper", label: "最新ニュース" },
  { href: "/app/posts", icon: "edit_square", label: "投稿作成" },
  { href: "/app/schedule", icon: "schedule", label: "下書き・スケジュール" },
  { href: "/app/analytics", icon: "monitoring", label: "分析・改善" },
  { href: "/app/ai-settings", icon: "description", label: "ベースmd" },
  { href: "/app/settings", icon: "tune", label: "設定" },
] as const satisfies readonly { href: string; icon: IconName; label: string }[];

export type AppNavigationIcon = (typeof APP_NAVIGATION_ITEMS)[number]["icon"];

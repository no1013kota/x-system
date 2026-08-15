import type { IconName } from "@/components/ui/icon";

/**
 * 左サイドバーのナビ項目（T-M8-04）。
 *
 * 新デザインは7項目（旧6項目）。**URLは変えていない** —— 既存のルート／タブへそのまま繋ぐ。
 *
 * ラベルは**その画面が自分を何と呼ぶか（h1）に合わせる**（T-M8-23）。デザインの
 * 「アカウント.md」をそのまま当てていたが、`/app/ai-settings` はアカウント設定・AI用途・学習ソース・
 * アカウント.md・プロンプトの5タブを持つ画面で、h1も「AI設定」。ヘッダーのパンくずはこのラベルを
 * 使うため、**ナビとパンくずが「アカウント.md」、本文が「AI設定」**という食い違いが出ていた
 * （デザインの画面分割とこのアプリのルート分割が一致しない箇所なので、文言を機械的に
 * 合わせると逆に分かりにくくなる）。
 *
 * `icon` は `components/ui/icon.tsx` の Material Symbols 名。
 */
export const APP_NAVIGATION_ITEMS = [
  // "output"（箱から出る矢印）はログアウトと同じ絵で紛らわしかった（T-M8-60）。
  { href: "/app", icon: "home", label: "ホーム" },
  { href: "/app/news", icon: "newspaper", label: "最新ニュース" },
  { href: "/app/posts", icon: "edit_square", label: "投稿作成" },
  { href: "/app/schedule", icon: "schedule", label: "スケジュール" },
  { href: "/app/analytics", icon: "monitoring", label: "投稿分析" },
  { href: "/app/ai-settings", icon: "description", label: "AI設定" },
  { href: "/app/settings", icon: "tune", label: "設定" },
] as const satisfies readonly { href: string; icon: IconName; label: string }[];

export type AppNavigationIcon = (typeof APP_NAVIGATION_ITEMS)[number]["icon"];

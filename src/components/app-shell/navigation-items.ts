import type { IconName } from "@/components/ui/icon";

/**
 * 左サイドバーのナビ項目（T-M8-04）。
 *
 * 新デザインは7項目（旧6項目）。**URLは変えていない** —— 既存のルート／タブへそのまま繋ぐ。
 *
 * ラベルは**その画面が自分を何と呼ぶか（h1）に合わせる**（T-M8-23）。
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
  // 招待プログラム（T-M8-174）。共有はスマホからが多いためモバイルにも出す。
  { href: "/app/invite", icon: "star_shine", label: "友達招待" },
  // 旧「AI設定」はT-M8-104で「設定」へ統合（/app/ai-settings はリダイレクトのみ）。
  { href: "/app/settings", icon: "tune", label: "設定" },
  // 公開ページへの導線（T-M8-173・運営者の指示）。App Shellの外だがナビから辿れる。
  // モバイル下部ナビは7枠が上限なので出さない（mobileHidden）。
  { href: "/prompt-templates", icon: "drafts", label: "プロンプト集", mobileHidden: true },
] as const satisfies readonly {
  href: string;
  icon: IconName;
  label: string;
  mobileHidden?: boolean;
}[];

export type AppNavigationIcon = (typeof APP_NAVIGATION_ITEMS)[number]["icon"];

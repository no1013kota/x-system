export const APP_NAVIGATION_ITEMS = [
  { href: "/app", icon: "home", label: "ホーム" },
  { href: "/app/news", icon: "news", label: "ニュース" },
  { href: "/app/posts", icon: "posts", label: "投稿" },
  { href: "/app/schedule", icon: "schedule", label: "スケジュール" },
  { href: "/app/analytics", icon: "analytics", label: "分析" },
  { href: "/app/ai-settings", icon: "ai", label: "AI設定" },
] as const;

export type AppNavigationIcon =
  (typeof APP_NAVIGATION_ITEMS)[number]["icon"];

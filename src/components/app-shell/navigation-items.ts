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
  /*
    `mobileLabel` はモバイル下部ナビ（7枠・1枠約55px）用の短縮形（T-M8-413）。
    フルのラベルは11pxでも1枠に収まらず「ニュー/ス」のように折れて読めなかった。
    無い項目は `label` をそのまま使う。
  */
  { href: "/app/news", icon: "newspaper", label: "最新ニュース", mobileLabel: "ニュース" },
  { href: "/app/posts", icon: "edit_square", label: "投稿作成", mobileLabel: "作成" },
  { href: "/app/schedule", icon: "schedule", label: "スケジュール", mobileLabel: "予定" },
  { href: "/app/analytics", icon: "monitoring", label: "投稿分析", mobileLabel: "分析" },
  /*
    プロンプト管理（T-M8-328・運営者の指示 2026-08-27）。設定のタブから独立した画面へ移した。
    並びは運営者の指定（投稿分析 → プロンプト → 友達招待）。
  */
  { href: "/app/prompts", icon: "smart_toy", label: "プロンプト" },
  // 招待プログラム（T-M8-174）。共有はスマホからが多いためモバイルにも出す。
  { href: "/app/invite", icon: "star_shine", label: "友達招待", mobileLabel: "招待" },
  /*
    **「設定」はナビに置かない**（T-M8-328・運営者の指示 2026-08-27）。
    サイドバー下部のアカウントアイコンを押すと、設定の各タブとログアウトが出る。
    毎日使うものではないので、常設の1枠を使わない。
  */
  // 公開ページへの導線（T-M8-173・運営者の指示）。App Shellの外だがナビから辿れる。
  // モバイル下部ナビは7枠が上限なので出さない（mobileHidden）。
  { href: "/prompt-templates", icon: "drafts", label: "プロンプト集", mobileHidden: true },
  { href: "/blog", icon: "article", label: "ブログ", mobileHidden: true },
] as const satisfies readonly {
  href: string;
  icon: IconName;
  label: string;
  /** モバイル下部ナビ用の短縮ラベル（T-M8-413）。無ければ label を使う。 */
  mobileLabel?: string;
  mobileHidden?: boolean;
}[];


/**
 * 実際に出すナビ項目（T-M8-445）。友達招待の導線は `FEATURE_INVITE_ENABLED` が true のときだけ出す
 * （運営者の指示 2026-09-05「一旦隠す。復活させるので戻しやすく」）。項目の定義自体は上に残し、
 * ここで落とすだけにする——復活はフラグを true にするだけで、並び順もラベルも戻る。
 */
export function appNavigationItems(options: { inviteEnabled: boolean }) {
  return APP_NAVIGATION_ITEMS.filter((item) => options.inviteEnabled || item.href !== "/app/invite");
}

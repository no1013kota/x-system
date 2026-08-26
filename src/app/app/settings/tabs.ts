/**
 * 設定のタブ（要件06 §3、T-M8-104で旧「設定」と旧「AI設定」を統合）。
 * 定義を1か所に置く理由: 画面とリンク元で同じ定義を使い、存在しないタブへの導線を
 * コンパイルで落とす（T-M8-18）。
 */

export const SETTINGS_TABS = [
  ["general", "設定"],
  ["billing", "課金・プラン"],
  ["account", "アカウント設定"],
  ["purposes", "AIモデル設定"],
  /*
    **「プロンプト」タブは廃止**（T-M8-328・運営者の指示 2026-08-27）。
    `/app/prompts` の独立した画面へ移した。旧slugは下のエイリアスで転送する——
    DBに保存済みの通知リンクや利用者のブックマークが `?tab=prompts` のまま届くため。
  */
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

/**
 * 旧タブslug（統合前の設定5タブ・AI設定5タブ）を新タブへ正規化する（T-M8-104）。
 * **DBに保存済みの通知リンクや利用者のブックマーク**が旧slugのまま届くため、
 * エイリアスは消せない。未知の値は先頭タブへ丸める（不正slugで白画面にしない）。
 */
const TAB_ALIASES: Record<string, SettingsTab> = {
  // 旧・設定（T-M8-104でひとつの「設定」タブへ）
  "x-accounts": "general",
  "api-keys": "general",
  notifications: "general",
  // 問い合わせタブは廃止（T-M8-104）。契約切れでも開ける限定タブ（route-guard）だったため、
  // 同じく限定タブの billing へ寄せる（旧リンクで一般設定が開く/弾かれるの不整合を作らない）。
  support: "billing",
  // 旧・AI設定
  persona: "account",
  learning: "account", // 学習ソースタブは廃止（T-M8-103。参考ソースはアカウント設定の一番下）
  // プロンプト関連は `/app/prompts` へ移設（T-M8-328）。設定側へ来たら先頭タブへ丸め、
  // 画面側で新しい場所を案内する（白画面にしない）。
  prompts: "general",
  "base-md": "general",
};

/** `/app/prompts` へ移した旧タブslug（T-M8-328）。リンク元がまだ古いときの案内に使う。 */
export const MOVED_TO_PROMPTS_SLUGS: readonly string[] = ["prompts", "base-md"];

/** リンクとして許容するslug（新タブ＋旧エイリアス）。tabs.test.ts の静的検査が使う。 */
export const ACCEPTED_SETTINGS_TAB_SLUGS: readonly string[] = [
  ...SETTINGS_TABS.map(([value]) => value),
  ...Object.keys(TAB_ALIASES),
];

export function normalizeSettingsTab(slug: string | undefined): SettingsTab {
  if (slug && SETTINGS_TABS.some(([value]) => value === slug)) return slug as SettingsTab;
  if (slug && slug in TAB_ALIASES) return TAB_ALIASES[slug];
  return "general";
}

/** プロンプトタブ内の区分（アカウント.md／投稿作成プロンプト／画像生成プロンプト・T-M8-104）。 */
export const PROMPT_SECTIONS = [
  ["account-md", "アカウント.md"],
  ["post-prompt", "投稿作成プロンプト"],
  ["image-prompt", "画像生成プロンプト"],
] as const;

export type PromptSection = (typeof PROMPT_SECTIONS)[number][0];

export function normalizePromptSection(slug: string | undefined): PromptSection {
  return PROMPT_SECTIONS.some(([value]) => value === slug)
    ? (slug as PromptSection)
    : "account-md";
}

/** タブを開くURL。slug は型で縛るので綴り間違いはコンパイルで落ちる。 */
export function settingsTabHref(tab: SettingsTab, section?: PromptSection): string {
  return section
    ? `/app/settings?tab=${tab}&sec=${section}`
    : `/app/settings?tab=${tab}`;
}

/**
 * アカウントメニューに出す設定への導線（T-M8-328）。
 * **`SETTINGS_TABS` から作る**——タブを増減したらメニューも自動で追随する（書き写さない）。
 */
export const ACCOUNT_MENU_SETTINGS_LINKS = SETTINGS_TABS.map(([value, label]) => ({
  href: settingsTabHref(value),
  label,
}));

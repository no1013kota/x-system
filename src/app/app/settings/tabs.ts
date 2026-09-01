/**
 * 設定のタブ（要件06 §1.2、T-M8-104で旧「設定」と旧「AI設定」を統合→T-M8-402で4タブへ再分割）。
 * 定義を1か所に置く理由: 画面とリンク元で同じ定義を使い、存在しないタブへの導線を
 * コンパイルで落とす（T-M8-18）。
 */

export const SETTINGS_TABS = [
  /*
    **4タブへ再分割**（T-M8-402・運営者の指示 2026-09-01「設定と課金・プランしかタブがなく質素」）。
    T-M8-104 で Xアカウント／APIキー／通知 を1つの「設定」タブへ畳んでいたが、
    アカウント設定（T-M8-400）・AIモデル設定（T-M8-401）がプロンプト画面へ移ったので、
    残った3つを元の区分へ戻す。旧 `general` は先頭タブへのエイリアス。
    **「プロンプト」タブは廃止**（T-M8-328）、**「アカウント設定」「AIモデル設定」も廃止**
    （T-M8-400/401）。それぞれ `/app/prompts` へ転送する（`SETTINGS_TAB_REDIRECTS`）。
  */
  ["x-accounts", "Xアカウント"],
  ["api-keys", "APIキー"],
  ["notifications", "通知"],
  ["billing", "課金・プラン"],
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

/**
 * 旧タブslug（統合前の設定5タブ・AI設定5タブ）を新タブへ正規化する（T-M8-104）。
 * **DBに保存済みの通知リンクや利用者のブックマーク**が旧slugのまま届くため、
 * エイリアスは消せない。未知の値は先頭タブへ丸める（不正slugで白画面にしない）。
 */
const TAB_ALIASES: Record<string, SettingsTab> = {
  // T-M8-104〜T-M8-401 の間の統合「設定」タブ（Xアカウント＋APIキー＋通知）。先頭タブへ。
  general: "x-accounts",
  // 問い合わせタブは廃止（T-M8-104）。契約切れでも開ける限定タブ（route-guard）だったため、
  // 同じく限定タブの billing へ寄せる（旧リンクで一般設定が開く/弾かれるの不整合を作らない）。
  support: "billing",
};

/**
 * 設定から**別の画面へ移った**タブ（T-M8-400）。`/app/settings?tab=<slug>` で届いたら
 * ここへ転送する——DBに保存済みの通知リンクや利用者のブックマークが旧slugのまま届くため、
 * 「押しても違う画面が出る」を作らない（原則2）。
 * - `account`／`persona`／`learning`: 参考アカウント＋5項目の入力欄は プロンプト＞アカウント.md
 * - `purposes`: AIモデル設定は プロンプト＞AIモデル設定（T-M8-401）
 * - `prompts`／`base-md`: プロンプト画面（T-M8-328）
 */
export const SETTINGS_TAB_REDIRECTS: Record<string, string> = {
  account: "/app/prompts?sec=account-md",
  persona: "/app/prompts?sec=account-md",
  learning: "/app/prompts?sec=account-md",
  purposes: "/app/prompts?sec=ai-models",
  prompts: "/app/prompts?sec=post-prompt",
  "base-md": "/app/prompts?sec=account-md",
};

/** 旧slugが別画面へ移っていれば転送先URLを返す（無ければ null）。 */
export function settingsTabRedirect(slug: string | undefined): string | null {
  return slug && Object.hasOwn(SETTINGS_TAB_REDIRECTS, slug) ? SETTINGS_TAB_REDIRECTS[slug] : null;
}


/** リンクとして許容するslug（新タブ＋旧エイリアス）。tabs.test.ts の静的検査が使う。 */
export const ACCEPTED_SETTINGS_TAB_SLUGS: readonly string[] = [
  ...SETTINGS_TABS.map(([value]) => value),
  ...Object.keys(TAB_ALIASES),
  ...Object.keys(SETTINGS_TAB_REDIRECTS),
];

export function normalizeSettingsTab(slug: string | undefined): SettingsTab {
  if (slug && SETTINGS_TABS.some(([value]) => value === slug)) return slug as SettingsTab;
  if (slug && slug in TAB_ALIASES) return TAB_ALIASES[slug];
  return "x-accounts";
}

/**
 * プロンプト画面の区分（アカウント.md／投稿作成プロンプト／画像生成プロンプト・T-M8-104）。
 * **AIモデル設定もここ**（T-M8-401・運営者の指示 2026-09-01）——どのAI・モデルで作るかは
 * 「AIへ渡す指示」と同じ場所で決める方が、設定（連携・課金・通知）に混ざるより探しやすい。
 * **先頭はAIモデル設定**（T-M8-405・運営者の指示 2026-09-01）。区分指定なしで開いたときも
 * 先頭（＝AIモデル設定）を出す——先頭と既定がずれると「押した区分と違う画面」に見える。
 */
export const PROMPT_SECTIONS = [
  ["ai-models", "AIモデル設定"],
  ["account-md", "アカウント.md"],
  ["post-prompt", "投稿作成プロンプト"],
  ["image-prompt", "画像生成プロンプト"],
] as const;

export type PromptSection = (typeof PROMPT_SECTIONS)[number][0];

export function normalizePromptSection(slug: string | undefined): PromptSection {
  return PROMPT_SECTIONS.some(([value]) => value === slug)
    ? (slug as PromptSection)
    : PROMPT_SECTIONS[0][0];
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

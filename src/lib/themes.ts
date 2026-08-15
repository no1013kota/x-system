import { NEWS_FETCH_CATEGORIES, type NewsCategory } from "./news";

/**
 * L-5 発信テーマ選択肢マスタ（要件02 §4.4/§6）。6テーマはニュース6分野
 * (news_category) と1対1で対応し、P-6 の <news_digest> 該当判定（プロンプト設計書
 * §4.2）に使う。自由入力テーマ（settings.themes.free_text）は該当判定の対象外。
 */
export interface ThemeOption {
  id: string;
  label: string;
  newsCategory: NewsCategory;
}

export const THEME_IDS = [
  "ai",
  "web3",
  "investment",
  "business",
  "business_ops",
  "sns",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_OPTIONS = [
  { id: "ai", label: "AI", newsCategory: "ai" },
  { id: "web3", label: "Web3", newsCategory: "web3" },
  { id: "investment", label: "投資", newsCategory: "investment" },
  { id: "business", label: "ビジネス", newsCategory: "business" },
  { id: "business_ops", label: "業務改善", newsCategory: "business_ops" },
  { id: "sns", label: "SNS運用", newsCategory: "sns" },
] as const satisfies readonly ThemeOption[];

/**
 * **運用中のテーマ**＝定時取得しているニュース分野（`NEWS_FETCH_CATEGORIES`）に対応するテーマ。
 * 最新ニュース画面の絞り込みと同じ導出元（T-M8-100・運営者の指示 2026-08-15）。
 * 投稿作成・スケジュールの選択肢と、投稿分析（SUGGEST）の推奨テーマはここに限定する。
 * 運用分野を変えれば選択肢も追随する。**語彙（保存・検証・表示）は6テーマのまま**——
 * 旧値を持つ既存データの表示と、アカウント設定（L-5・PRD §8.3で6のまま維持と決定）を壊さない。
 */
export const OPERATED_THEME_OPTIONS = THEME_OPTIONS.filter((theme) =>
  (NEWS_FETCH_CATEGORIES as readonly NewsCategory[]).includes(theme.newsCategory),
);

export const OPERATED_THEME_IDS = OPERATED_THEME_OPTIONS.map((theme) => theme.id);

const BY_ID: ReadonlyMap<string, ThemeOption> = new Map(
  THEME_OPTIONS.map((theme) => [theme.id, theme]),
);

/** Returns the distinct news categories a set of theme ids maps to. */
export function themesToNewsCategories(themeIds: string[]): NewsCategory[] {
  const cats = new Set<NewsCategory>();
  for (const id of themeIds) {
    const cat = BY_ID.get(id)?.newsCategory;
    if (cat) cats.add(cat);
  }
  return [...cats];
}

export function themeLabel(themeId: ThemeId): string {
  return BY_ID.get(themeId)?.label ?? themeId;
}

const LABEL_BY_CATEGORY: ReadonlyMap<NewsCategory, string> = new Map(
  THEME_OPTIONS.map((theme) => [theme.newsCategory, theme.label]),
);

/** news_category の日本語ラベル（SYS-NEWS `{{category_ja}}`。テーマと1対1対応）。 */
export function newsCategoryLabel(category: NewsCategory): string {
  return LABEL_BY_CATEGORY.get(category) ?? category;
}

import { NEWS_FETCH_CATEGORIES, type NewsCategory } from "./news";

/**
 * L-5 発信テーマ選択肢マスタ（要件02 §4.4/§6）。テーマはニュース分野
 * (news_category) と1対1で対応し、P-6 の <news_digest> 該当判定（プロンプト設計書
 * §4.2）に使う。自由入力テーマ（settings.themes.free_text）は該当判定の対象外。
 *
 * 運用テーマは6つ（AI・Web3・SNS・投資・恋愛・美容。運営者の指示 2026-08-22・T-M8-189）。
 * 旧テーマ（ビジネス・業務改善）は**語彙に残す**——保存済みのpersona設定・schedule_slots・
 * news_items の表示と検証を壊さないため。選択肢（OPERATED_THEME_OPTIONS）には出ない。
 */
export interface ThemeOption {
  id: string;
  label: string;
  newsCategory: NewsCategory;
}

export const THEME_IDS = [
  "ai",
  "web3",
  "sns",
  "investment",
  "love",
  "beauty",
  "business",
  "business_ops",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_OPTIONS = [
  { id: "ai", label: "AI", newsCategory: "ai" },
  { id: "web3", label: "Web3", newsCategory: "web3" },
  { id: "sns", label: "SNS運用", newsCategory: "sns" },
  { id: "investment", label: "投資", newsCategory: "investment" },
  { id: "love", label: "恋愛", newsCategory: "love" },
  { id: "beauty", label: "美容", newsCategory: "beauty" },
  // 旧テーマ（運用終了・T-M8-189）。保存済みデータの表示・検証用に語彙へ残す。
  { id: "business", label: "ビジネス", newsCategory: "business" },
  { id: "business_ops", label: "業務改善", newsCategory: "business_ops" },
] as const satisfies readonly ThemeOption[];

/**
 * **運用中のテーマ**＝定時取得しているニュース分野（`NEWS_FETCH_CATEGORIES`）に対応するテーマ。
 * 最新ニュース画面のソート選択肢と同じ導出元（T-M8-100/188）。
 * AI設定・投稿作成・スケジュール・通知設定の選択肢と、投稿分析（SUGGEST）の推奨テーマは
 * ここに限定する。運用分野を変えれば選択肢も追随する。**語彙（保存・検証・表示）は
 * 旧テーマ込みの8つのまま**——旧値を持つ既存データの表示と検証を壊さない（T-M8-189）。
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

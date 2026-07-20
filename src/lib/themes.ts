import type { NewsCategory } from "./news";

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

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: "ai", label: "AI", newsCategory: "ai" },
  { id: "web3", label: "Web3", newsCategory: "web3" },
  { id: "investment", label: "投資", newsCategory: "investment" },
  { id: "business", label: "ビジネス", newsCategory: "business" },
  { id: "business_ops", label: "業務改善", newsCategory: "business_ops" },
  { id: "sns", label: "SNS運用", newsCategory: "sns" },
];

const BY_ID = new Map(THEME_OPTIONS.map((t) => [t.id, t]));

/** Returns the distinct news categories a set of theme ids maps to. */
export function themesToNewsCategories(themeIds: string[]): NewsCategory[] {
  const cats = new Set<NewsCategory>();
  for (const id of themeIds) {
    const cat = BY_ID.get(id)?.newsCategory;
    if (cat) cats.add(cat);
  }
  return [...cats];
}

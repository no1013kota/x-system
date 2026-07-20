import type { NewsCategory } from "./news";

/**
 * L-5 発信テーマ選択肢マスタ（要件02 §4.4/§6）。各選択肢は news_category 対応を
 * 持ち、P-6 の <news_digest> 該当判定（プロンプト設計書 §4.2）に使う。ニュース分野は
 * AI・Web3・投資の3分野固定のため、同名テーマだけがニュース連携を持ち、それ以外
 * （ビジネス・業務改善・SNS運用）は newsCategory=null で該当判定の対象外。自由入力
 * テーマも対象外。
 */
export interface ThemeOption {
  id: string;
  label: string;
  newsCategory: NewsCategory | null;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: "ai", label: "AI", newsCategory: "ai" },
  { id: "web3", label: "Web3", newsCategory: "web3" },
  { id: "investment", label: "投資", newsCategory: "investment" },
  { id: "business", label: "ビジネス", newsCategory: null },
  { id: "business_ops", label: "業務改善", newsCategory: null },
  { id: "sns", label: "SNS運用", newsCategory: null },
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

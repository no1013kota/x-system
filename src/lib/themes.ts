import type { NewsCategory } from "./news";

/**
 * L-5 発信テーマ選択肢マスタ（要件02 §4.4/§6）。各選択肢は news_category 対応を
 * 持ち、P-6 の <news_digest> 該当判定（プロンプト設計書 §4.2）に使う。newsCategory
 * が null のテーマは該当判定の対象外。自由入力テーマも対象外。
 *
 * 注: 選択肢の最終確定はユーザー判断待ち（tasks/BACKLOG.md 要決定・M2関連）。
 * 現状は暫定マスタ。
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
  { id: "marketing", label: "マーケティング", newsCategory: null },
  { id: "business_ops", label: "業務改善", newsCategory: null },
  { id: "freelance", label: "フリーランス・個人事業", newsCategory: null },
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

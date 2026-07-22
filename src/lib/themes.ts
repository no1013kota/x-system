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

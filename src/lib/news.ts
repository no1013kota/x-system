import { DB_ENUMS } from "./db/enums";

/**
 * News categories for the common news pipeline (要件02 §6, PRD N-1).
 * Derived from the DB enum so code and DB never drift.
 */
export const NEWS_CATEGORIES = DB_ENUMS.news_category;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/**
 * **定時取得する分野**（2026-08-22 運営者決定・T-M8-189。AI・Web3・SNS・投資・恋愛・美容の6分野）。
 *
 * 取得はRSS巡回（T-M8-380・`src/lib/news/feeds.ts`）で、費用は**新着の要約だけ**に発生する
 * （mechanicalモデル・月$1〜3見込み）。分野を増やす手順: (1) DB enumに分野があることを確認
 * (2) `NEWS_FEEDS` へ監視フィードを足す (3) この配列へ足す。**ここに無い分野は記事が増えない**ので、
 * 購読設定の選択肢もこれに合わせる必要がある（要件02 §6）。
 */
export const NEWS_FETCH_CATEGORIES = ["ai", "web3", "sns", "investment", "love", "beauty"] as const satisfies readonly NewsCategory[];

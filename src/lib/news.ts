import { DB_ENUMS } from "./db/enums";

/**
 * News categories for the common news pipeline (要件02 §6, PRD N-1): AI・Web3・
 * 投資 fixed. Derived from the DB enum so code and DB never drift.
 */
export const NEWS_CATEGORIES = DB_ENUMS.news_category;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/**
 * **定時取得する分野**（2026-08-02 ユーザー決定・T-M7-55）。
 *
 * 取得費用は「分野数 × 実行回数」だけで決まり、**利用者数には依存しない**（記事は全員で共有する
 * 共通処理）。実測で1分野1回あたり **$0.24〜$0.50** かかり、6分野×毎時12回では月$518〜1,071に
 * なるため、実際に運用する3分野へ絞る。
 *
 * `NEWS_CATEGORIES`（DB enum・利用者が購読設定で選べる全分野）とは別物。**ここに無い分野は
 * 記事が増えない**ので、購読設定の選択肢もこれに合わせる必要がある（要件02 §6）。
 */
export const NEWS_FETCH_CATEGORIES = ["ai", "investment", "sns"] as const satisfies readonly NewsCategory[];

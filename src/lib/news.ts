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
 * 取得費用は「分野数 × 実行回数」だけで決まり、**利用者数には依存しない**（記事は全員で共有する
 * 共通処理）。実測で1分野1回あたり **$0.24〜$0.50**・1日6回起動なので、6分野では
 * **$8.6〜18/日（月$260〜540）**。2026-08-02（T-M7-55）は費用を理由に3分野
 * （ai・investment・sns。$130〜270/月）へ絞っていたが、恋愛・美容を含む6分野運用を
 * 運営者が指示した。費用を下げたい場合は分野を減らすか起動回数を減らす（要件04 §6）。
 *
 * `NEWS_CATEGORIES`（DB enum・利用者が購読設定で選べる全分野）とは別物。**ここに無い分野は
 * 記事が増えない**ので、購読設定の選択肢もこれに合わせる必要がある（要件02 §6）。
 */
export const NEWS_FETCH_CATEGORIES = ["ai", "web3", "sns", "investment", "love", "beauty"] as const satisfies readonly NewsCategory[];

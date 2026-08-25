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
 * 共通処理）。実測（2026-08-22・同一分野同一窓の直接比較）: Sonnetで$0.15〜0.17/回、
 * Haiku 4.5で$0.09/回。6分野×5回/日＝月900回なので **Sonnet 月$137〜156／Haiku 月約$84**。
 * 費用の主因は出力tokenとWeb検索回数（入力tokenではない・PRD §6.1）。下げる手段は効く順に
 * (a) `NEWS_TEXT_MODEL` で安いモデルへ (b) 出力件数・summary長を絞る (c) 起動回数
 * (d) 分野数（要件04 §6）。
 *
 * `NEWS_CATEGORIES`（DB enum・利用者が購読設定で選べる全分野）とは別物。**ここに無い分野は
 * 記事が増えない**ので、購読設定の選択肢もこれに合わせる必要がある（要件02 §6）。
 */
export const NEWS_FETCH_CATEGORIES = ["ai", "web3", "sns", "investment", "love", "beauty"] as const satisfies readonly NewsCategory[];

import { DB_ENUMS } from "./db/enums";

/**
 * News categories for the common news pipeline (要件02 §6, PRD N-1): AI・Web3・
 * 投資 fixed. Derived from the DB enum so code and DB never drift.
 */
export const NEWS_CATEGORIES = DB_ENUMS.news_category;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

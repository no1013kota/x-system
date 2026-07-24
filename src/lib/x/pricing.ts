/**
 * X API 呼び出しの原価単価（要件04 §10, 要件02 §3.17, T-M3-17）。
 * 単価は環境変数 X_COST_* の snapshot を注入する（業務ロジックへ直書きしない）。
 * 読取（x_post_read / x_user_read）は課金単価を持たない（0）。media upload は原価台帳から
 * 除外するため本表に含めない（要件04 §10）。
 */

/** external_api_usage_events.operation のうち X が使う値（migration の CHECK と一致）。 */
export type XCostOperation =
  | "x_post_create"
  | "x_post_delete"
  | "x_post_read"
  | "x_user_read";

export interface XCostConfig {
  /** 通常投稿1件の単価（X_COST_CONTENT_CREATE_USD）。 */
  contentCreateUsd: number;
  /** URL付き投稿1件の単価（X_COST_CONTENT_CREATE_WITH_URL_USD）。 */
  contentCreateWithUrlUsd: number;
  /** 投稿削除1件の単価（X_COST_INTERACTION_DELETE_USD）。 */
  interactionDeleteUsd: number;
}

/**
 * operation（＋create時のURL有無）に対応する実行時単価を返す。
 * post_create は本文にURLを含むかで content / content_with_url を分ける（要件02 §4 counter分類と対称）。
 */
export function xUnitCost(
  operation: XCostOperation,
  config: XCostConfig,
  opts: { hasUrl?: boolean } = {},
): number {
  switch (operation) {
    case "x_post_create":
      return opts.hasUrl ? config.contentCreateWithUrlUsd : config.contentCreateUsd;
    case "x_post_delete":
      return config.interactionDeleteUsd;
    case "x_post_read":
    case "x_user_read":
      return 0;
  }
}

/**
 * X API 呼び出しの原価単価（要件04 §10, 要件02 §3.17, T-M3-17）。
 * 単価は環境変数 X_COST_* の snapshot を注入する（業務ロジックへ直書きしない）。
 * media upload は原価台帳から除外するため本表に含めない（要件04 §10）。
 *
 * **読取（x_post_read / x_user_read）にも単価がある**（T-M8-91）。当初は「読取は課金されない」
 * 前提で単価0固定だったが、X API の pay-per-usage は **応答に含まれた resource 1件ごとに課金する**
 * （Posts: Read $0.005／User: Read $0.010・docs.x.com の pricing、2026-08-15 確認）。単価0のままだと
 * metrics_collector・学習・改善提案の読取費用が台帳に載らず、実費より小さく見える（原則4）。
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
  /** ポスト読取1件の単価（X_COST_POST_READ_USD）。応答のポスト数で乗算される。 */
  postReadUsd: number;
  /** ユーザー読取1件の単価（X_COST_USER_READ_USD）。 */
  userReadUsd: number;
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
      return config.postReadUsd;
    case "x_user_read":
      return config.userReadUsd;
  }
}

/**
 * ジョブ冪等keyの生成（要件04 §3, 要件05 §12）。
 * - 子job: `parent:{parent_job_id}:{kind}:{draft_id}` の決定的key。worker再実行でも
 *   同じkeyになり重複作成しない。
 * - ユーザー操作: クライアント生成UUIDにユーザーIDをprefixして `request_key` にする。
 */

export function childJobKey(
  parentJobId: string,
  kind: string,
  draftId: string,
): string {
  return `parent:${parentJobId}:${kind}:${draftId}`;
}

/**
 * ユーザー操作の request_key。クライアント生成トークン（UUID）にユーザーIDをprefix。
 * 同じ (userId, token) からは同じkeyになる（再送時に同一keyを使えば冪等）。
 * `token` は必須。冪等性を壊さないため、サーバ側で既定値（毎回新規UUID）を生成しない
 * ——トークンは画面（クライアント）が生成し再送時も同じ値を渡す（要件04 §3, 要件05 §12）。
 */
export function requestKey(userId: string, token: string): string {
  return `${userId}:${token}`;
}

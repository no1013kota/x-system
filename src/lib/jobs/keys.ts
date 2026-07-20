import { randomUUID } from "node:crypto";

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
 */
export function requestKey(userId: string, token: string = randomUUID()): string {
  return `${userId}:${token}`;
}

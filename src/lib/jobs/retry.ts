/**
 * ジョブの再試行ポリシー（要件04 §5）。429/5xx/network は指数backoff+jitterで
 * 最大2回retry（初回含め最大3 attempt）。401/403・無効入力は再試行しない。
 * provider内部のretryは`attempt`ではなく`usage.calls`側に記録する（本ポリシーの外）。
 */

/** 初回 + 最大2回retry。attempt がこの値以上なら自動取得しない。 */
export const MAX_ATTEMPTS = 3;

export type ErrorKind =
  | "rate_limit" // 429
  | "server" // 5xx
  | "network" // 接続断・タイムアウト
  | "auth" // 401/403（キー・token失効）
  | "invalid" // 無効入力・無効モデル等の恒久エラー
  | "unknown";

/** 自動retry対象か（429/5xx/network のみ）。 */
export function isRetryable(kind: ErrorKind): boolean {
  return kind === "rate_limit" || kind === "server" || kind === "network";
}

const BASE_MS = 1_000;
const CAP_MS = 30_000;
const JITTER_FRACTION = 0.5;

/**
 * attempt 回目（1始まり）の失敗に対する次回待機ミリ秒。指数（base * 2^(attempt-1)、
 * capで頭打ち）＋加算jitter（0〜exp*0.5）。jitterの乱数は注入可能（テスト決定化用）。
 */
export function backoffMs(attempt: number, rng: () => number = Math.random): number {
  const n = Math.max(1, attempt);
  const exp = Math.min(CAP_MS, BASE_MS * 2 ** (n - 1));
  const jitter = Math.floor(rng() * exp * JITTER_FRACTION);
  return exp + jitter;
}

/**
 * 失敗時に retry すべきか（retryable かつ attempt が上限未満）。
 * attempt は「今回消費した後の値」を渡す。
 */
export function shouldRetry(kind: ErrorKind, attempt: number): boolean {
  return isRetryable(kind) && attempt < MAX_ATTEMPTS;
}

/**
 * Function実行のdeadline管理（要件04 §5, 要件01 §6）。Function開始から180秒を
 * 処理deadlineとし、残り30秒未満なら追加のprovider callを開始しない（retryableとして
 * queuedへ戻す）。各callのtimeoutは90秒とdeadline残の短い方。`now`は注入可能（テスト用）。
 */

export const DEADLINE_MS = 180_000;
export const MIN_CALL_HEADROOM_MS = 30_000;
export const MAX_CALL_MS = 90_000;

export interface Deadline {
  /** deadlineまでの残りms（負にもなり得る）。 */
  remainingMs(): number;
  /** 残り時間が最低必要分（既定30秒）以上あり、追加callを開始してよいか。 */
  canStartCall(minRemainingMs?: number): boolean;
  /** 次のprovider callのtimeout ms（maxCallMsとdeadline残の小さい方、下限0）。 */
  callTimeoutMs(maxCallMs?: number): number;
}

export function createDeadline(
  budgetMs: number = DEADLINE_MS,
  now: () => number = Date.now,
): Deadline {
  const end = now() + budgetMs;
  return {
    remainingMs: () => end - now(),
    canStartCall: (minRemainingMs = MIN_CALL_HEADROOM_MS) =>
      end - now() >= minRemainingMs,
    callTimeoutMs: (maxCallMs = MAX_CALL_MS) =>
      Math.max(0, Math.min(maxCallMs, end - now())),
  };
}

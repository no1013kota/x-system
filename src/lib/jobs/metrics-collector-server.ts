import "server-only";

import { pooledQueryable, runInPooledTx } from "../db/pool";
import { buildXReadDeps } from "../x/read-client-server";
import { readTweetMetrics } from "../x/read-client";
import { getValidXAccessToken } from "../x/token-refresh-server";
import { createDeadline } from "./deadline";
import { recordUnexpectedError } from "../observability/sentry";
import {
  executeMetricsCollection,
  type MetricsCollectorResult,
} from "./metrics-collector";

/**
 * metrics_collector の server-only 配線（K-1, 要件04 §6/§13, T-M5-12）。pool・token復号/refresh・X読取・
 * Function deadline を束ねて中核へ渡す。token取得不能（失効等）や1アカウントの読取失敗は隔離してスキップし、
 * run全体を落とさず次窓へ委ねる。
 */

const pooledDb = pooledQueryable();

export async function runMetricsCollector(now: Date): Promise<MetricsCollectorResult> {
  const deadline = createDeadline();
  return executeMetricsCollection({
    db: pooledDb,
    runInTx: runInPooledTx,
    now,
    isPastDeadline: () => !deadline.canStartCall(),
    onError: (scope, err) =>
      console.error(`[metrics_collector] ${scope.xAccountId}${scope.draftId ? `/${scope.draftId}` : ""}`, err),
    getAccessToken: async (xAccountId) => {
      try {
        return await getValidXAccessToken(xAccountId);
      } catch (error) {
        // 同上。中核（metrics-collector.ts）のログ経路をこのcatchが無効化していた。
        recordUnexpectedError(error, { at: "metrics-collector:token", xAccountId });
        return null;
      }
    },
    readTweetMetrics: async ({ xAccountId, userId, accessToken, tweetIds, keyBase }) => {
      const deps = buildXReadDeps(accessToken, { userId, xAccountId, jobId: null });
      const { tweets } = await readTweetMetrics(deps, { tweetIds, idempotencyKeyBase: keyBase });
      return tweets;
    },
  });
}

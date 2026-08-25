import {
  getRecentPosts,
  getTweetMetrics,
  getUsersByIds,
  type XClientDeps,
  type XRecentPost,
  type XTweetMetrics,
  type XUserMetrics,
} from "./client";
import type { XCostConfig } from "./pricing";
import { xUnitCost } from "./pricing";
import type { Queryable } from "./token-refresh";
import { recordedXCall, type XUsageContext } from "./usage";

/**
 * X API 読取クライアント（L-1〜3・K-1・K-3, 要件04 §12/§13, T-M5-01）。学習・metrics_collector・
 * follower_snapshot・「分析を開始」で共用する。既存の `client.ts`（retry/backoff・401/403即失敗）を土台に、
 * ページング蓄積（timeline）・100件chunk（tweet lookup）・原価台帳への冪等記録（`recordedXCall`：
 * x_post_read / x_user_read）を加える。読取単価は `costs`（X_COST_*READ*_USD の snapshot）から取る
 * （T-M8-91。pay-per-usage は応答の resource 1件ごとに課金するため、単価0のままだと実費より小さく見える）。
 *
 * 契約: 1つの `XReadDeps` は単一の `accessToken`（＝単一user context）に束ねる。異なる user token を
 * 同一呼び出しへ混ぜない（要件04 §6）。呼び出し側は対象アカウントのtokenごとに deps を作る。
 */

export const X_TWEET_LOOKUP_MAX = 100;
export const X_TIMELINE_PAGE_MIN = 5;
export const X_TIMELINE_PAGE_MAX = 100;
const MAX_TIMELINE_PAGES = 20;

export interface XReadDeps {
  db: Queryable;
  /** HTTP/mode を束ねた client deps（server配線は xClientDeps）。 */
  x: XClientDeps;
  /** 対象アカウントのuser context access token（単一）。 */
  accessToken: string;
  /** 原価台帳の userId / xAccountId / jobId。 */
  ctx: XUsageContext;
  /** 実行時単価の snapshot（server配線は xCostConfig()）。 */
  costs: XCostConfig;
}

export interface XTimelineResult {
  posts: XRecentPost[];
}

/** 指定ユーザーの直近ポストを limit 件まで取得する（ページング蓄積・各ページを x_post_read 記録）。 */
export async function readUserTimeline(
  deps: XReadDeps,
  input: {
    userId: string;
    limit: number;
    idempotencyKeyBase: string;
    /** 取得窓の開始（ISO 8601）。改善提案は直近30日を渡す（T-M8-91）。 */
    startTime?: string;
    /** リポスト・返信を除く（本人のコンテンツ投稿だけを見る）。 */
    excludeRepliesAndReposts?: boolean;
    /** 実績メトリクス・画像/URLの有無を取る（読取単価は変わらない。1投稿$0.005/件のまま）。 */
    withMetrics?: boolean;
  },
): Promise<XTimelineResult> {
  const posts: XRecentPost[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_TIMELINE_PAGES; page++) {
    const remaining = input.limit - posts.length;
    if (remaining <= 0) break;
    const perPage = Math.min(X_TIMELINE_PAGE_MAX, Math.max(X_TIMELINE_PAGE_MIN, remaining));
    const pageToken = token;
    const res = await recordedXCall(
      deps.db,
      {
        ctx: deps.ctx,
        operation: "x_post_read",
        unitCostUsd: xUnitCost("x_post_read", deps.costs),
        idempotencyKey: `${input.idempotencyKeyBase}:page:${page}`,
      },
      () =>
        getRecentPosts(
          deps.accessToken,
          {
            userId: input.userId,
            maxResults: perPage,
            paginationToken: pageToken,
            startTime: input.startTime,
            excludeRepliesAndReposts: input.excludeRepliesAndReposts,
            withMetrics: input.withMetrics,
          },
          deps.x,
        ),
    );
    posts.push(...res.posts);
    if (!res.nextToken || res.posts.length === 0) break;
    token = res.nextToken;
  }
  return { posts: posts.slice(0, input.limit) };
}

export interface XTweetLookupResult {
  tweets: XTweetMetrics[];
}

/** tweet_id を最大100件/リクエストの chunk で lookup する（各chunkを x_post_read 記録）。 */
export async function readTweetMetrics(
  deps: XReadDeps,
  input: { tweetIds: string[]; idempotencyKeyBase: string },
): Promise<XTweetLookupResult> {
  const tweets: XTweetMetrics[] = [];
  for (let offset = 0; offset < input.tweetIds.length; offset += X_TWEET_LOOKUP_MAX) {
    const chunk = input.tweetIds.slice(offset, offset + X_TWEET_LOOKUP_MAX);
    const index = offset / X_TWEET_LOOKUP_MAX;
    const res = await recordedXCall(
      deps.db,
      {
        ctx: deps.ctx,
        operation: "x_post_read",
        unitCostUsd: xUnitCost("x_post_read", deps.costs),
        idempotencyKey: `${input.idempotencyKeyBase}:chunk:${index}`,
      },
      () => getTweetMetrics(deps.accessToken, chunk, deps.x),
    );
    tweets.push(...res.tweets);
  }
  return { tweets };
}

export interface XUserLookupResult {
  users: XUserMetrics[];
}

/** ユーザーの followers_count を lookup する（最大100 id・x_user_read 記録）。 */
export async function readUserFollowers(
  deps: XReadDeps,
  input: { userIds: string[]; idempotencyKey: string },
): Promise<XUserLookupResult> {
  const res = await recordedXCall(
    deps.db,
    {
      ctx: deps.ctx,
      operation: "x_user_read",
      unitCostUsd: xUnitCost("x_user_read", deps.costs),
      idempotencyKey: input.idempotencyKey,
    },
    () => getUsersByIds(deps.accessToken, input.userIds.slice(0, X_TWEET_LOOKUP_MAX), deps.x),
  );
  return { users: res.users };
}

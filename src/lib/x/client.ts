import { randomUUID } from "node:crypto";

import {
  backoffMs,
  MAX_ATTEMPTS,
  shouldRetry,
  type ErrorKind,
} from "../jobs/retry";

/**
 * X (Twitter) API v2 投稿・読取クライアント（PRD §8.1, 要件04 §5/§10, 要件01 §3.1/§3.4, K-1）。
 * SDK非依存・server-only非依存の純粋層で、HTTP・mode・乱数・時計は注入する（テスト可能に保つ）。
 * env（X_POSTING_MODE）束ね・global fetch 配線・request ID 抽出は `client-server.ts`。
 *
 * 公式仕様確認（docs.x.com, 2026-07-22）: POST /2/tweets の body は
 * `text` / `reply.in_reply_to_tweet_id` / `media.media_ids[]` / `quote_tweet_id`、応答は `data.id`。
 * DELETE /2/tweets/:id・GET /2/users/me・GET /2/tweets?ids=…&tweet.fields=public_metrics,non_public_metrics
 * は X API v2 の標準形。
 *
 * retry: 429/5xx/network は指数backoff+jitterで最大2回retry（要件04 §5, `../jobs/retry` を再利用）。
 * 401/403 は retry せず `XApiError`(kind='auth') = 失効エラーへ正規化する（呼び出し側が再連携化）。
 * `X_POSTING_MODE=dry_run` では投稿・削除・media upload の HTTP を一切呼ばず、擬似結果を返す
 * （実 tweet_id も利用枠も作らない）。読取（users/me・metrics）は tweet を作らないため mode に依らず実行する。
 */

export const X_API_BASE_URL = "https://api.x.com/2";

export type XPostingMode = "dry_run" | "live";

export interface XHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  /** provider の request/transaction ID（原価台帳用）。無ければ null。 */
  requestId: string | null;
}

export type XHttp = (req: {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<XHttpResponse>;

export class XApiError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly status: number,
    /** X の error コード（token/本文は含めない）。 */
    readonly errorCode: string | null,
    readonly kind: ErrorKind,
  ) {
    super(`x api error ${status}: ${errorCode ?? kind}`);
    this.name = "XApiError";
    this.retryable = kind === "rate_limit" || kind === "server" || kind === "network";
  }
}

/** 401/403（token/permission 失効）＝再連携が必要なエラーか。 */
export function isXAuthError(err: unknown): err is XApiError {
  return err instanceof XApiError && err.kind === "auth";
}

/** 原価台帳（external_api_usage_events）へ渡す共通メタ。request ID と数量を返す。 */
export interface XApiMeta {
  requestId: string | null;
  quantity: number;
  dryRun: boolean;
}

export interface XCreatePostResult extends XApiMeta {
  tweetId: string;
}
export interface XDeletePostResult extends XApiMeta {
  deleted: boolean;
}
export interface XUser {
  id: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
}
export interface XUserResult extends XApiMeta {
  user: XUser;
}
export interface XTweetMetrics {
  id: string;
  text: string | null;
  publicMetrics: Record<string, number> | null;
  nonPublicMetrics: Record<string, number> | null;
}
export interface XTweetMetricsResult extends XApiMeta {
  tweets: XTweetMetrics[];
}
export interface XUserMetrics {
  id: string;
  username: string;
  followersCount: number | null;
}
export interface XUserMetricsResult extends XApiMeta {
  users: XUserMetrics[];
}
export interface XUploadMediaResult extends XApiMeta {
  mediaId: string;
}

export interface XClientDeps {
  http: XHttp;
  mode: XPostingMode;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  newId?: () => string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function classify(status: number): ErrorKind {
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status === 401 || status === 403) return "auth";
  return "invalid";
}

function parseErrorCode(text: string): string | null {
  try {
    const j = JSON.parse(text) as {
      error?: string;
      title?: string;
      errors?: Array<{ code?: string | number }>;
    };
    return (
      j.error ??
      j.title ??
      (j.errors?.[0]?.code != null ? String(j.errors[0].code) : null)
    );
  // eslint-disable-next-line no-restricted-syntax -- エラー本文がJSONでないだけ。status と kind は XApiError に残る
  } catch {
    return null;
  }
}

function baseUrl(deps: XClientDeps): string {
  return deps.baseUrl ?? X_API_BASE_URL;
}

function newId(deps: XClientDeps): string {
  return (deps.newId ?? randomUUID)();
}

function authHeaders(accessToken: string, json: boolean): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  if (json) h["content-type"] = "application/json";
  return h;
}

/** retry込みで1リクエストを実行し、成功応答の本文(JSON)と request ID を返す。 */
async function callX<T>(
  req: Parameters<XHttp>[0],
  deps: XClientDeps,
): Promise<{ body: T; requestId: string | null }> {
  const rng = deps.rng ?? Math.random;
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt++) {
    let err: XApiError;
    try {
      const res = await deps.http(req);
      const text = await res.text();
      if (res.ok) {
        return { body: text ? (JSON.parse(text) as T) : ({} as T), requestId: res.requestId };
      }
      err = new XApiError(res.status, parseErrorCode(text), classify(res.status));
    } catch (e) {
      if (e instanceof XApiError) err = e;
      // network（接続断・タイムアウト等）は fetch が throw する。
      else err = new XApiError(0, null, "network");
    }
    if (!shouldRetry(err.kind, attempt) || attempt >= MAX_ATTEMPTS) throw err;
    await sleep(backoffMs(attempt, rng));
  }
}

/** POST /2/tweets（reply連結・media・quote対応, 要件04 §10）。dry_runではHTTPを呼ばない。 */
export async function createPost(
  accessToken: string,
  input: {
    text: string;
    inReplyToTweetId?: string;
    mediaIds?: string[];
    quoteTweetId?: string;
  },
  deps: XClientDeps,
): Promise<XCreatePostResult> {
  if (deps.mode === "dry_run") {
    return { tweetId: `dryrun-tweet-${newId(deps)}`, requestId: null, quantity: 1, dryRun: true };
  }
  const body: Record<string, unknown> = { text: input.text };
  if (input.inReplyToTweetId) {
    body.reply = { in_reply_to_tweet_id: input.inReplyToTweetId };
  }
  if (input.mediaIds && input.mediaIds.length > 0) {
    body.media = { media_ids: input.mediaIds };
  }
  if (input.quoteTweetId) body.quote_tweet_id = input.quoteTweetId;

  const { body: res, requestId } = await callX<{ data: { id: string } }>(
    {
      method: "POST",
      url: `${baseUrl(deps)}/tweets`,
      headers: authHeaders(accessToken, true),
      body: JSON.stringify(body),
    },
    deps,
  );
  return { tweetId: res.data.id, requestId, quantity: 1, dryRun: false };
}

/** DELETE /2/tweets/:id（ロールバック削除, 要件04 §10/§11）。dry_runではHTTPを呼ばない。 */
export async function deletePost(
  accessToken: string,
  tweetId: string,
  deps: XClientDeps,
): Promise<XDeletePostResult> {
  if (deps.mode === "dry_run") {
    return { deleted: true, requestId: null, quantity: 1, dryRun: true };
  }
  const { body: res, requestId } = await callX<{ data: { deleted: boolean } }>(
    {
      method: "DELETE",
      url: `${baseUrl(deps)}/tweets/${encodeURIComponent(tweetId)}`,
      headers: authHeaders(accessToken, false),
    },
    deps,
  );
  return { deleted: res.data.deleted === true, requestId, quantity: 1, dryRun: false };
}

/** GET /2/users/me（連携確認・handle/表示名取得, 要件05 §4.3）。読取はmodeに依らず実行。 */
export async function getMe(
  accessToken: string,
  deps: XClientDeps,
): Promise<XUserResult> {
  const { body: res, requestId } = await callX<{
    data: { id: string; username: string; name: string; profile_image_url?: string };
  }>(
    {
      method: "GET",
      url: `${baseUrl(deps)}/users/me?user.fields=profile_image_url`,
      headers: authHeaders(accessToken, false),
    },
    deps,
  );
  return {
    user: {
      id: res.data.id,
      username: res.data.username,
      name: res.data.name,
      profileImageUrl: res.data.profile_image_url ?? null,
    },
    requestId,
    quantity: 1,
    dryRun: false,
  };
}

/** GET /2/users/by/username/{username}（L-1 参考アカウントの user_id 解決, 要件04 §12）。 */
export async function getUserByUsername(
  accessToken: string,
  username: string,
  deps: XClientDeps,
): Promise<XUserResult> {
  const { body: res, requestId } = await callX<{
    data: { id: string; username: string; name: string; profile_image_url?: string };
  }>(
    {
      method: "GET",
      url: `${baseUrl(deps)}/users/by/username/${encodeURIComponent(username)}?user.fields=profile_image_url`,
      headers: authHeaders(accessToken, false),
    },
    deps,
  );
  return {
    user: {
      id: res.data.id,
      username: res.data.username,
      name: res.data.name,
      profileImageUrl: res.data.profile_image_url ?? null,
    },
    requestId,
    quantity: 1,
    dryRun: false,
  };
}

/** GET /2/tweets?ids=…&tweet.fields=public_metrics,non_public_metrics,text（K-1/L-2, 要件04 §12/§13）。 */
export async function getTweetMetrics(
  accessToken: string,
  tweetIds: string[],
  deps: XClientDeps,
): Promise<XTweetMetricsResult> {
  const ids = tweetIds.join(",");
  const fields = "public_metrics,non_public_metrics,text";
  const { body: res, requestId } = await callX<{
    data?: Array<{
      id: string;
      text?: string;
      public_metrics?: Record<string, number>;
      non_public_metrics?: Record<string, number>;
    }>;
  }>(
    {
      method: "GET",
      url: `${baseUrl(deps)}/tweets?ids=${encodeURIComponent(ids)}&tweet.fields=${fields}`,
      headers: authHeaders(accessToken, false),
    },
    deps,
  );
  const tweets: XTweetMetrics[] = (res.data ?? []).map((t) => ({
    id: t.id,
    text: t.text ?? null,
    publicMetrics: t.public_metrics ?? null,
    nonPublicMetrics: t.non_public_metrics ?? null,
  }));
  return { tweets, requestId, quantity: tweets.length, dryRun: false };
}

export interface XRecentPost {
  id: string;
  text: string;
  createdAt: string | null;
  /** replied_to の参照tweet id（reply連投の照合用）。無ければ null。 */
  inReplyToId: string | null;
}
export interface XRecentPostsResult extends XApiMeta {
  posts: XRecentPost[];
  /** 次ページ token（無ければ null）。ページングで蓄積する呼び出し側が使う。 */
  nextToken: string | null;
}

/**
 * GET /2/users/:id/tweets（結果不明時の照合用・直近投稿取得, 要件04 §10/§11/§12）。読取はmode非依存。
 * 公式仕様確認（docs.x.com, 2026-07-24）: `tweet.fields=created_at,referenced_tweets`・`max_results`
 * は5〜100・`pagination_token` で次ページ。`data[].id/text/created_at/referenced_tweets[{type,id}]`、
 * `meta.next_token`。実装時に version 再確認。
 */
export async function getRecentPosts(
  accessToken: string,
  input: { userId: string; maxResults?: number; paginationToken?: string },
  deps: XClientDeps,
): Promise<XRecentPostsResult> {
  const max = input.maxResults ?? 20;
  const params = new URLSearchParams({
    max_results: String(max),
    "tweet.fields": "created_at,referenced_tweets",
  });
  if (input.paginationToken) params.set("pagination_token", input.paginationToken);
  const { body: res, requestId } = await callX<{
    data?: Array<{
      id: string;
      text: string;
      created_at?: string;
      referenced_tweets?: Array<{ type: string; id: string }>;
    }>;
    meta?: { next_token?: string };
  }>(
    {
      method: "GET",
      url: `${baseUrl(deps)}/users/${encodeURIComponent(input.userId)}/tweets?${params.toString()}`,
      headers: authHeaders(accessToken, false),
    },
    deps,
  );
  const posts: XRecentPost[] = (res.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    createdAt: t.created_at ?? null,
    inReplyToId: t.referenced_tweets?.find((r) => r.type === "replied_to")?.id ?? null,
  }));
  return {
    posts,
    nextToken: res.meta?.next_token ?? null,
    requestId,
    quantity: Math.max(1, posts.length),
    dryRun: false,
  };
}

/**
 * GET /2/users?ids=…&user.fields=public_metrics（K-3 フォロワー数・user lookup, 要件04 §13）。
 * 公式仕様確認（docs.x.com, 2026-07-24）: 最大100 id・`public_metrics.followers_count`。実装時に再確認。
 */
export async function getUsersByIds(
  accessToken: string,
  userIds: string[],
  deps: XClientDeps,
): Promise<XUserMetricsResult> {
  const ids = userIds.join(",");
  const { body: res, requestId } = await callX<{
    data?: Array<{
      id: string;
      username: string;
      public_metrics?: { followers_count?: number };
    }>;
  }>(
    {
      method: "GET",
      url: `${baseUrl(deps)}/users?ids=${encodeURIComponent(ids)}&user.fields=public_metrics`,
      headers: authHeaders(accessToken, false),
    },
    deps,
  );
  const users: XUserMetrics[] = (res.data ?? []).map((u) => ({
    id: u.id,
    username: u.username,
    followersCount: u.public_metrics?.followers_count ?? null,
  }));
  return { users, requestId, quantity: Math.max(1, users.length), dryRun: false };
}

/**
 * POST /2/media/upload（画像添付, 要件04 §10 step4）。dry_runは擬似media idを返す（HTTP不呼）。
 * 公式仕様確認（docs.x.com, 2026-07-24）: application/json で `media`(base64)・`media_category`
 * (画像は `tweet_image`)・`media_type`(MIME) を送り、応答 `data.id` が media id 文字列。
 * media upload は原価台帳から除外する（要件04 §10・運用logのみ）。
 */
export async function uploadMedia(
  accessToken: string,
  input: { data: Buffer | Uint8Array; mimeType: string },
  deps: XClientDeps,
): Promise<XUploadMediaResult> {
  if (deps.mode === "dry_run") {
    return { mediaId: `dryrun-media-${newId(deps)}`, requestId: null, quantity: 1, dryRun: true };
  }
  const media = Buffer.from(input.data).toString("base64");
  const { body: res, requestId } = await callX<{ data: { id: string } }>(
    {
      method: "POST",
      url: `${baseUrl(deps)}/media/upload`,
      headers: authHeaders(accessToken, true),
      body: JSON.stringify({
        media,
        media_category: "tweet_image",
        media_type: input.mimeType,
      }),
    },
    deps,
  );
  return { mediaId: res.data.id, requestId, quantity: 1, dryRun: false };
}

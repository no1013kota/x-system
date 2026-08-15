import "server-only";

import { pooledQueryable, runInPooledTx } from "../db/pool";
import type { PlanId } from "../plans";
import { readUserTimeline } from "../x/read-client";
import { buildXReadDeps } from "../x/read-client-server";
import { getValidXAccessToken } from "../x/token-refresh-server";
import type { Deadline } from "./deadline";
import type { JobContext } from "./handlers";
import { executeSuggestion } from "./suggestion";
import {
  buildDraftTagIndex,
  buildSuggestionInput,
  SUGGEST_PERIOD_DAYS,
  SUGGEST_TIMELINE_MAX,
  type SuggestionInput,
} from "./suggestion-input";

/**
 * suggestion ハンドラの server-only 配線（K-2, T-M8-91）。pool・provider解決（BYOK=ユーザー／premium=運営）・
 * **Xタイムラインの読取**（token復号/refresh・直近30日・最大100件・メトリクス付き）と、Exos投稿の
 * 型/テーマタグ（drafts突合）を束ねて中核へ渡す。
 *
 * X読取は応答1件ごとに課金される（X_COST_POST_READ_USD・premiumは運営App＝運営負担、BYOKは利用者の
 * X App＝利用者負担）。`recordedXCall` が件数×単価を原価台帳へ冪等記録する。
 */

const pooledDb = pooledQueryable();

const runInTx = runInPooledTx;

async function resolveProvider(input: { plan: string; userId: string; deadline: Deadline }) {
  // provider解決はenv検証に触れるため、実際にLLMを呼ぶ時点（投稿1件以上のとき）まで遅延ロードする。
  const { resolveTextProvider } = await import("../ai/resolve-provider-server");
  return resolveTextProvider({ plan: input.plan as PlanId, userId: input.userId }, { deadline: input.deadline });
}

/** Exos AIで作った投稿の tweet_id → 型/テーマ の索引（タイムラインの投稿へタグ付けする）。 */
async function fetchDraftTags(xAccountId: string) {
  const { rows } = await pooledDb.query<{
    tweet_ids: string[] | null;
    pattern: string | null;
    theme: string | null;
  }>(
    `select d.tweet_ids, d.pattern, d.input->>'theme' as theme
       from drafts d
      where d.x_account_id = $1
        and d.tweet_ids is not null
        and d.posted_at >= now() - interval '${SUGGEST_PERIOD_DAYS + 1} days'`,
    [xAccountId],
  );
  return buildDraftTagIndex(rows);
}

async function fetchPosts(
  jobId: string,
  job: { xAccountId: string; xUserId: string; userId: string },
): Promise<SuggestionInput> {
  const accessToken = await getValidXAccessToken(job.xAccountId);
  const readDeps = buildXReadDeps(accessToken, {
    userId: job.userId,
    xAccountId: job.xAccountId,
    jobId,
  });

  const startTime = new Date(Date.now() - SUGGEST_PERIOD_DAYS * 86_400_000).toISOString();
  const [{ posts }, draftTags] = await Promise.all([
    readUserTimeline(readDeps, {
      userId: job.xUserId,
      limit: SUGGEST_TIMELINE_MAX,
      idempotencyKeyBase: `sug:${jobId}:timeline`,
      startTime,
      excludeRepliesAndReposts: true,
      withMetrics: true,
    }),
    fetchDraftTags(job.xAccountId),
  ]);
  return buildSuggestionInput(posts, draftTags);
}

export async function suggestionHandler(ctx: JobContext): Promise<void> {
  await executeSuggestion({
    db: pooledDb,
    jobId: ctx.jobId,
    runInTx,
    resolveProvider,
    fetchPosts: (job) => fetchPosts(ctx.jobId, job),
  });
}

import "server-only";

import { pooledQueryable, runInPooledTx } from "../db/pool";
import type { PlanId } from "../plans";
import { readUserTimeline } from "../x/read-client";
import { buildXReadDeps } from "../x/read-client-server";
import { getValidXAccessToken } from "../x/token-refresh-server";
import type { Deadline } from "./deadline";
import type { JobContext } from "./handlers";
import { executeSuggestion } from "./suggestion";
import { buildDraftTagIndex, buildInputFromStored, type SuggestionInput } from "./suggestion-input";
import { TIMELINE_FETCH_MAX, timelineFetchStart } from "./suggestion-timeline";
import {
  loadStoredTimeline,
  newestStoredPostedAt,
  upsertTimelinePosts,
} from "./suggestion-timeline-store";

/**
 * suggestion ハンドラの server-only 配線（K-2, T-M8-94）。毎朝8:00 JSTの自動実行で:
 * 1. **増分取得**: 保存済み最新投稿の48時間前から現在までを X API から取得（初回は30日・最大100件）。
 *    重なり分は upsert でメトリクス（表示回数等）を追い直す
 * 2. **保存**: `x_timeline_posts` へ upsert（本サービス経由の投稿には drafts 突合で型/テーマを付与）
 * 3. **分析**: 保存済みの全投稿（新しい順に最大 SUGGEST_ANALYZE_MAX 件）を中核へ渡す
 *
 * X読取は応答1件ごとに課金（X_COST_POST_READ_USD）。premium は運営App＝運営負担、
 * BYOK は利用者のX App＝利用者負担。`recordedXCall` が件数×単価を原価台帳へ冪等記録する。
 */

const pooledDb = pooledQueryable();

const runInTx = runInPooledTx;

async function resolveProvider(input: { plan: string; userId: string; deadline: Deadline }) {
  // provider解決はenv検証に触れるため、実際にLLMを呼ぶ時点（投稿1件以上のとき）まで遅延ロードする。
  const { resolveTextProvider } = await import("../ai/resolve-provider-server");
  return resolveTextProvider({ plan: input.plan as PlanId, userId: input.userId }, { deadline: input.deadline });
}

/** Exos AIで作った投稿の tweet_id → 型/テーマ の索引（新規取得分へタグ付けする）。 */
async function fetchDraftTags(xAccountId: string) {
  const { rows } = await pooledDb.query<{
    tweet_ids: string[] | null;
    pattern: string | null;
    theme: string | null;
  }>(
    `select d.tweet_ids, d.pattern, d.input->>'theme' as theme
       from drafts d
      where d.x_account_id = $1 and d.tweet_ids is not null`,
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

  // 1. 増分の窓を決める（保存済み最新の48時間前〜。初回は30日）。
  const newest = await newestStoredPostedAt(pooledDb, job.xAccountId);
  const startTime = timelineFetchStart(newest, Date.now());

  const [{ posts }, draftTags] = await Promise.all([
    readUserTimeline(readDeps, {
      userId: job.xUserId,
      limit: TIMELINE_FETCH_MAX,
      idempotencyKeyBase: `sug:${jobId}:timeline`,
      startTime,
      excludeRepliesAndReposts: true,
      withMetrics: true,
    }),
    fetchDraftTags(job.xAccountId),
  ]);

  // 2. upsert（重なり分はメトリクスと本文を更新。型/テーマは一度付いたら保持）。
  await upsertTimelinePosts(pooledDb, job.xAccountId, posts, draftTags);

  // 3. 分析対象は保存済みの全投稿（新しい順に上限件数）。
  return buildInputFromStored(await loadStoredTimeline(pooledDb, job.xAccountId));
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

import "server-only";

import { resolveTextProvider } from "../ai/resolve-provider-server";
import { pooledQueryable, runInPooledTx } from "../db/pool";
import type { PlanId } from "../plans";
import { xClientDeps } from "../x/client-server";
import { getUserByUsername } from "../x/client";
import { buildXReadDeps } from "../x/read-client-server";
import { readTweetMetrics, readUserTimeline } from "../x/read-client";
import { getValidXAccessToken } from "../x/token-refresh-server";
import { createDeadline, type Deadline } from "./deadline";
import { executeLearningAnalysis } from "./learning-analysis";
import { executeMdMerge } from "./md-merge";
import type { JobContext } from "./handlers";

/**
 * learning_analysis ハンドラの server-only 配線（T-M5-03/T-M5-04）。pool・provider解決・X読取（token復号/
 * refresh・handle→user_id 解決・read-client）を束ね、分析成功後は同一job内 MD-MERGE を実行する。
 */

const pooledDb = pooledQueryable();

const runInTx = runInPooledTx;

function resolveProvider(input: { plan: string; userId: string; deadline: Deadline }) {
  return resolveTextProvider({ plan: input.plan as PlanId, userId: input.userId }, { deadline: input.deadline });
}

export async function learningAnalysisHandler(ctx: JobContext): Promise<void> {
  const meta = (
    await pooledDb.query<{ x_account_id: string; x_user_id: string; user_id: string }>(
      `select gj.x_account_id, xa.x_user_id, xa.user_id
         from generation_jobs gj join x_accounts xa on xa.id = gj.x_account_id
        where gj.id = $1`,
      [ctx.jobId],
    )
  ).rows[0];
  if (!meta) return; // 中核が not_found を投げる

  const accessToken = await getValidXAccessToken(meta.x_account_id);
  const readCtx = { userId: meta.user_id, xAccountId: meta.x_account_id, jobId: ctx.jobId };
  const readDeps = buildXReadDeps(accessToken, readCtx);
  const client = xClientDeps();
  // 分析phaseとMD-MERGE phaseで1つの Function-wide deadline を共有する（実経過を合算・要件04 §5）。
  const deadline = createDeadline();
  const makeDeadline = (): Deadline => deadline;

  await executeLearningAnalysis({
    db: pooledDb,
    jobId: ctx.jobId,
    runInTx,
    resolveProvider,
    makeDeadline,
    // 分析成功後、同一job内で該当セクションをmergeしてbase_md新versionを確定する（T-M5-04）。
    mergeAfterAnalysis: async (sourceId) => {
      await executeMdMerge(
        { db: pooledDb, jobId: ctx.jobId, runInTx, resolveProvider, makeDeadline },
        { confirmSourceId: sourceId },
      );
    },
    fetchReferenceAccountPosts: async ({ handle }) => {
      const user = await getUserByUsername(accessToken, handle, client);
      const { posts } = await readUserTimeline(readDeps, {
        userId: user.user.id,
        limit: 20,
        idempotencyKeyBase: `learning:${ctx.jobId}:ref_account`,
      });
      return posts.map((p) => p.text);
    },
    fetchReferencePost: async ({ tweetId }) => {
      const { tweets } = await readTweetMetrics(readDeps, {
        tweetIds: [tweetId],
        idempotencyKeyBase: `learning:${ctx.jobId}:ref_post`,
      });
      const t = tweets[0];
      if (!t) return null;
      return { text: t.text ?? "", metrics: t.publicMetrics };
    },
    fetchOwnPosts: async () => {
      const { posts } = await readUserTimeline(readDeps, {
        userId: meta.x_user_id,
        limit: 100,
        idempotencyKeyBase: `learning:${ctx.jobId}:own`,
      });
      return posts.map((p) => p.text);
    },
  });
}

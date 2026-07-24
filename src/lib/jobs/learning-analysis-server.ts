import "server-only";

import { resolveTextProvider } from "../ai/resolve-provider-server";
import { getPool, withTransaction } from "../db/pool";
import type { PlanId } from "../plans";
import { xClientDeps } from "../x/client-server";
import { getUserByUsername } from "../x/client";
import { buildXReadDeps } from "../x/read-client-server";
import { readTweetMetrics, readUserTimeline } from "../x/read-client";
import { getValidXAccessToken } from "../x/token-refresh-server";
import type { Queryable } from "../x/token-refresh";
import { executeLearningAnalysis } from "./learning-analysis";
import type { JobContext } from "./handlers";

/**
 * learning_analysis ハンドラの server-only 配線（T-M5-03）。pool・provider解決・X読取（token復号/refresh・
 * handle→user_id 解決・read-client）を束ねて純粋層（learning-analysis.ts）へ注入する。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

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

  await executeLearningAnalysis({
    db: pooledDb,
    jobId: ctx.jobId,
    runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
    resolveProvider: (input) =>
      resolveTextProvider(
        { plan: input.plan as PlanId, userId: input.userId },
        { deadline: input.deadline },
      ),
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

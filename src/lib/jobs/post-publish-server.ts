import "server-only";

import { getPool, withTransaction } from "../db/pool";
import { env } from "../env";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  createPost,
  deletePost,
  getRecentPosts,
  getTweetMetrics,
  uploadMedia,
  type XClientDeps,
} from "../x/client";
import { xClientDeps, xCostConfig } from "../x/client-server";
import { getValidXAccessToken } from "../x/token-refresh-server";
import type { Queryable } from "../x/token-refresh";
import type { JobContext } from "./handlers";
import { executePostPublish } from "./post-publish";

/**
 * post_publish ハンドラの server-only 配線（要件04 §10, T-M3-18）。pool・X token・X client
 * （投稿/ media upload）・原価単価・Storage download・日次上限を束ねて executePostPublish を駆動する。
 * DB は pool（都度取得・即解放）で、各ポスト成功直後の tweet_ids/consume を確定させる。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

export async function postPublishHandler(ctx: JobContext): Promise<void> {
  const clientDeps: XClientDeps = xClientDeps();
  const bucket = env.SUPABASE_STORAGE_BUCKET_IMAGES;

  await executePostPublish({
    db: pooledDb,
    jobId: ctx.jobId,
    runInTx: (fn) => withTransaction((c) => fn(c as unknown as Queryable)),
    getAccessToken: (xAccountId) => getValidXAccessToken(xAccountId),
    createPost: (accessToken, input) => createPost(accessToken, input, clientDeps),
    deletePost: (accessToken, tweetId) => deletePost(accessToken, tweetId, clientDeps),
    uploadMedia: (accessToken, input) => uploadMedia(accessToken, input, clientDeps),
    downloadImage: async (storagePath) => {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.storage.from(bucket).download(storagePath);
      if (error || !data) throw new Error(`storage download failed: ${error?.message ?? "no data"}`);
      const buffer = Buffer.from(await data.arrayBuffer());
      return { data: buffer, mimeType: data.type || "image/webp" };
    },
    getRecentPosts: async (accessToken, xUserId) => {
      const res = await getRecentPosts(accessToken, { userId: xUserId }, clientDeps);
      return res.posts;
    },
    checkTweetExists: async (accessToken, tweetId) => {
      try {
        const res = await getTweetMetrics(accessToken, [tweetId], clientDeps);
        return res.tweets.length > 0;
      } catch {
        return null; // 判定不能
      }
    },
    costConfig: xCostConfig(),
    dailyLimit: env.X_DAILY_POST_LIMIT,
    postingLive: env.X_POSTING_MODE === "live",
  });
}

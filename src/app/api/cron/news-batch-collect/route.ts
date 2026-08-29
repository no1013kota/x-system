import { pooledQueryable } from "@/lib/db/pool";
import { twentyMinWindowKey } from "@/lib/jobs/cron";
import { handleCronRoute } from "@/lib/jobs/cron-route";
import { fanOutNewsDigest, newsDigestWindowStart } from "@/lib/jobs/news-digest";

/**
 * ニュースBatchの取り込みcron（T-M8-338・運営者の指示 2026-08-27「20分ごとで良い」）。
 *
 * 定時（12時・19時）に投げたバッチの結果を拾って `news_items` へ保存する。
 * Batchはほとんど1時間以内に終わるので、20分おきに見に行けば十分。
 * **何も無ければ何もしない**（待ちのバッチが0件ならAPIも叩かない）。
 *
 * ダイジェスト通知はここで出す——保存されたのがこの時点だから。
 * 投げた時点（news-fetch）ではまだ1件も保存されていない。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 6分野ぶんのJSONLを取り込んで保存するだけ。生成は走らないので短くてよい。
export const maxDuration = 120;

const pooledDb = pooledQueryable();

export async function GET(request: Request): Promise<Response> {
  return handleCronRoute(request, {
    name: "news_batch_collect",
    // ニュース取得と同じく本番だけで動かす（T-M8-326。stg・ローカルで費用を出さない）。
    productionOnly: true,
    windowKey: twentyMinWindowKey,
    work: async ({ now }) => {
      const { collectNewsBatches } = await import("@/lib/jobs/news-batch-server");
      const collected = await collectNewsBatches(now);
      if (collected.savedTotal === 0) return { ...collected, digest: null };
      // 保存できた回だけ通知を配る（要件04 §14）。0件のときに配ると空の通知になる。
      const digest = await fanOutNewsDigest({
        db: pooledDb,
        windowStart: newsDigestWindowStart(now),
      });
      return {
        ...collected,
        digest: { matchedUsers: digest.matchedUsers, notified: digest.notified },
      };
    },
    response: ({ ran, windowKey, result }) => ({
      ok: true,
      ran,
      window: windowKey,
      ...(result ?? {}),
    }),
  });
}

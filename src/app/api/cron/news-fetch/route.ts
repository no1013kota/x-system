import { pooledQueryable } from "@/lib/db/pool";
import { hourWindowKey } from "@/lib/jobs/cron";
import { handleCronRoute } from "@/lib/jobs/cron-route";
import { createDeadline } from "@/lib/jobs/deadline";
import { fanOutNewsDigest, newsDigestWindowStart } from "@/lib/jobs/news-digest";
import { runNewsFetch } from "@/lib/jobs/news-fetch";
import { researchNews } from "@/lib/jobs/news-research";

/** ニュース取得cron（要件04 §2/§6, N-1, T-M4-11）。毎時起動・6分野最大3並列・分野別commit。 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

const pooledDb = pooledQueryable();

export async function GET(request: Request): Promise<Response> {
  return handleCronRoute(request, {
    name: "news_fetch",
    windowKey: hourWindowKey,
    work: async ({ now, windowKey }) => {
      // provider解決はenvに触れるため認証・受付通過後に遅延ロードする（module読込で env 検証を走らせない）。
      const { resolveNewsProvider } = await import("@/lib/ai/resolve-provider-server");
      const fetched = await runNewsFetch({
        db: pooledDb,
        // 分野ごとの結果を残す（0件が「該当なし」か「全件破棄」かを後から説明できるように・T-M7-40）。
        windowKey,
        researchCategory: (category) => {
          // 分野ごとに新しい deadline を与える（pause_turn継続予算・要件04 §5）。
          const { textGen, provider, model } = resolveNewsProvider({ deadline: createDeadline() });
          return researchNews(category, {
            db: pooledDb,
            textGen,
            provider,
            model,
            clock: now,
            ledgerKeyPrefix: `news:${windowKey}:${category}`,
          });
        },
        onError: (category, err) => console.error(`[news_fetch] ${category}`, err),
      });
      // 6分野settle後、成功分野の新規ニュースを対象に時間単位ダイジェストを fan-out する（要件04 §14）。
      const digest = await fanOutNewsDigest({ db: pooledDb, windowStart: newsDigestWindowStart(now) });
      // commit後の best-effort 即時メール送信（残りは scheduler_tick が回収, T-M4-16/17）。
      const { dispatchNotificationEmail } = await import("@/lib/email/notification-email-server");
      for (const id of digest.createdIds) dispatchNotificationEmail(id);
      return { ...fetched, digest: { matchedUsers: digest.matchedUsers, notified: digest.notified } };
    },
    response: ({ ran, windowKey, result }) => ({
      ok: true,
      ran,
      window: windowKey,
      ...(result ?? {}),
    }),
  });
}

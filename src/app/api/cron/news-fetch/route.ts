import { pooledQueryable } from "@/lib/db/pool";
import { hourWindowKey } from "@/lib/jobs/cron";
import { handleCronRoute } from "@/lib/jobs/cron-route";
import { createDeadline } from "@/lib/jobs/deadline";
import { fanOutNewsDigest, newsDigestWindowStart } from "@/lib/jobs/news-digest";
import { runNewsFetch } from "@/lib/jobs/news-fetch";
import { researchNews } from "@/lib/jobs/news-research";

/** ニュース取得cron（要件04 §2/§6, N-1, T-M4-11）。定時起動・6分野同時（最大6並列）・分野別commit。 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 6分野を1巡で回しても、1分野の実行予算（deadline 180秒）＋後処理に余裕を持たせる
// （200秒だと1分野が遅いだけで打ち切られ、ダイジェスト通知まで消える・T-M8-192）。
export const maxDuration = 300;

const pooledDb = pooledQueryable();

export async function GET(request: Request): Promise<Response> {
  return handleCronRoute(request, {
    name: "news_fetch",
    /*
      **stg・ローカルでは動かさない**（T-M8-326・運営者の指示 2026-08-27
      「私が意図的に戻すまで起動しないように」）。本番の外部API費用の97.6%がこのcronで
      （実測: Anthropic $23.31 のうち $23.14 が196回）、検証環境で回すと同じだけ費用が出る。
      戻すときはこの1行を消す。
    */
    productionOnly: true,
    windowKey: hourWindowKey,
    work: async ({ now, windowKey }) => {
      // provider解決はenvに触れるため認証・受付通過後に遅延ロードする（module読込で env 検証を走らせない）。
      const { resolveNewsProvider } = await import("@/lib/ai/resolve-provider-server");
      const { collectNewsBatches, newsBatchAvailable, submitNewsBatch } = await import(
        "@/lib/jobs/news-batch-server"
      );

      /*
        **Batchで投げて終わる**（T-M8-338・運営者の指示 2026-08-27）。トークンが半額になる。
        結果はこの起動では返らないので、20分おきの `news-batch-collect` が取り込む。
        ここでも1回だけ取り込みを試すのは、**前回ぶんが残っていたら先に片付けるため**
        （取り込みcronが止まっていても、次の定時で回復する経路を1本持たせる）。

        Batchが使えない構成（`NEWS_TEXT_PROVIDER` がAnthropic以外）では従来どおり同期実行する。
      */
      if (newsBatchAvailable()) {
        const collectedFirst = await collectNewsBatches(now);
        const { model } = resolveNewsProvider();
        const submitted = await submitNewsBatch({ windowKey, now, model });
        // ダイジェスト通知は取り込み側が出す（ここではまだ保存されたニュースが無い）。
        return {
          mode: "batch" as const,
          submitted: submitted !== null,
          categories: submitted?.categories.length ?? 0,
          collectedFirst,
        };
      }

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
      // 通知はアプリ内のみ（メール送信はT-M8-222で廃止）。
      const digest = await fanOutNewsDigest({ db: pooledDb, windowStart: newsDigestWindowStart(now) });
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

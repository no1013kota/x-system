import { pooledQueryable } from "@/lib/db/pool";
import { tenMinWindowKey } from "@/lib/jobs/cron";
import { handleCronRoute } from "@/lib/jobs/cron-route";
import { fanOutNewsDigest, newsDigestWindowStart } from "@/lib/jobs/news-digest";
import { runNewsRssFetch } from "@/lib/jobs/news-rss";

/**
 * ニュース取得cron（要件04 §2/§6, N-1）。**RSS巡回**（T-M8-380・運営者の指示 2026-08-30）。
 *
 * 旧: 1日2回、AIがWeb検索でリサーチ（Message Batches・1回$2.3）。
 * 新: **10分おきにRSSを巡回**し（T-M8-383で20分→10分。費用は新着数にしか比例しない）、新着があったときだけ安いモデルで要約する。
 * 発見は無料なので、頻度を上げても費用は新着の件数にしか比例しない。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// フィード十数本のHTTP取得＋新着があれば要約1〜数call。90秒あれば足りるが余裕を持つ。
export const maxDuration = 120;

const pooledDb = pooledQueryable();

/** フィード取得。1本10秒で諦める（遅い1本に巡回全体を引きずらせない）。 */
async function fetchFeed(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; ExosAI-news/1.0)" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
}

export async function GET(request: Request): Promise<Response> {
  return handleCronRoute(request, {
    name: "news_fetch",
    /*
      **stg・ローカルでは動かさない**（T-M8-326の決定を維持）。RSSなら費用はほぼ無いが、
      検証環境が同じ記事を保存し始めると「本番で新着が出ない」（検証で先に取得済みに見える）
      類の混乱は起きないものの、動作確認はsmokeで明示的に叩く運用に揃えておく。
      戻すときはこの1行を消す。
    */
    productionOnly: true,
    windowKey: tenMinWindowKey,
    work: async ({ now, windowKey }) => {
      // provider解決はenvに触れるため認証・受付通過後に遅延ロードする。
      const { summarizeArticles } = await import("@/lib/news/summarize-server");
      const fetched = await runNewsRssFetch({
        db: pooledDb,
        fetchFeed,
        summarize: (category, articles) =>
          summarizeArticles(category, articles, {
            ledgerKey: `news-sum:${windowKey}:${category}`,
          }),
        now,
        windowKey,
        onError: (category, err) => console.error(`[news_fetch] ${category}`, err),
      });
      // 新着があった分だけ時間単位ダイジェストを fan-out する（旧仕組みと同じ・要件04 §14）。
      const digest = await fanOutNewsDigest({ db: pooledDb, windowStart: newsDigestWindowStart(now) });
      /*
        メール通知ONの利用者へ同じ内容を送る（T-M8-407）。宛先は**今回作れた通知行**からだけ
        作られるので、同じ窓の再実行で二重送信にならない。失敗は利用者ごとに隔離して数える。
      */
      const { sendNewsDigestMails } = await import("@/lib/jobs/news-digest-mail-server");
      const emails = await sendNewsDigestMails(digest.emailTargets);
      return {
        totalSaved: fetched.totalSaved,
        categories: fetched.categories.map((c) => ({
          category: c.category,
          ok: c.ok,
          fetched: c.fetched,
          saved: c.saved,
          dropped: c.dropped,
          feeds: `${c.feedsOk}/${c.feedsTotal}`,
          errorCode: c.errorCode,
        })),
        digest: { matchedUsers: digest.matchedUsers, notified: digest.notified },
        // 送れなかった件数を結果に出す（原則1。0件と「全部失敗」を区別する）。
        emails,
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

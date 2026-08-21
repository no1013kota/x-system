import { isValidCronAuth } from "@/lib/jobs/auth";
import { classifySentryDsn } from "@/lib/ops/config-status";

/**
 * 運営者向けの状態診断の入口（T-M7-34）。
 *
 * **cron へは登録しない。手動で叩いたときだけ動く。** 読み取りだけで副作用は無く、費用も
 * 発生しない（実APIは叩かない）。デプロイ先の状態を運営者が確認できることが目的。
 *
 *   curl "<base>/api/cron/doctor" -H "authorization: Bearer $CRON_SECRET"
 *
 * 判定と文言は `src/lib/ops/diagnostics.ts` に集約し、`npm run doctor` と同じものを使う
 * （SQLを二重に持たない）。`doctor` は「ローカル基盤の状態（DB接続・未適用migration）」だけを
 * 自分で見て、データの状態はこの route から取る。アプリが落ちていればそれ自体が答えなので、
 * 「アプリが起動していません」と次の一手を出して終わる。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  // env/DB へ触れるため認証通過後に遅延ロードする。
  const { pooledQueryable } = await import("@/lib/db/pool");
  const { collectDiagnostics } = await import("@/lib/ops/diagnostics");
  const { env } = await import("@/lib/env");
  // 定時実行は本番でしか動かない。それ以外で「止まっている」と赤くしない（常に赤い表示は読まれなくなる）。
  const report = await collectDiagnostics(pooledQueryable(), {
    schedulerExpected: env.APP_ENV === "production",
    // 人間確認が実際に効いているかを、その環境自身のSupabaseへ問い合わせて確かめる（T-M7-53）。
    captcha: {
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    // プラン管理の操作がStripe側で有効かを読み取る（T-M8-32）。鍵が無い環境では
    // 「判定できません」になるだけで、赤くはしない。
    portal: {
      configurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
      stripe: env.STRIPE_SECRET_KEY ? (await import("@/lib/stripe/client")).stripe : null,
    },
    // 画面の金額とStripeの請求額を突き合わせる（T-M8-141）。読み取りのみで費用は無い。
    prices: {
      priceIds: {
        standard: env.STRIPE_PRICE_STANDARD_MONTHLY,
        expert: env.STRIPE_PRICE_EXPERT_MONTHLY,
        premium: env.STRIPE_PRICE_PREMIUM_MONTHLY,
      },
      stripe: env.STRIPE_SECRET_KEY ? (await import("@/lib/stripe/client")).stripe : null,
    },
    /*
      **この環境が実際に使っている設定**（T-M8-147）。値そのものではなく種別・有無だけを渡す
      （この応答はHTTPで返るため、鍵が混ざる経路を作らない）。`actualOrigin` はリクエストの
      URLから取る——`APP_BASE_URL` と突き合わせて、メールのリンクとX連携の戻り先が
      別ドメインを指していないことを、動いているアプリ自身に答えさせる。
    */
    /*
      **決済を受け付けられる状態か**（T-M8-148）。Priceの金額が一致していても、
      アカウントが有効化されていなければ申し込みは必ず失敗する。production では異常として出す。
    */
    stripeAccount: {
      stripe: env.STRIPE_SECRET_KEY ? (await import("@/lib/stripe/client")).stripe : null,
      requireLiveCharges: env.APP_ENV === "production",
    },
    // 確認メールの送信元（T-M8-147）。Supabase側の `smtp_user` と同じ値を設定している。
    mailSenderEmail: env.SMTP_USER ?? null,
    // ブログ記事（blog/*.md）がこのデプロイに同梱されているか（T-M8-184）。
    blog: await (async () => {
      const { readBlogCollection } = await import("@/lib/blog/blog-files");
      const collection = readBlogCollection();
      return {
        directoryExists: collection.directoryExists,
        published: collection.posts.filter((post) => !post.draft).length,
        drafts: collection.posts.filter((post) => post.draft).length,
        invalidFiles: collection.invalid.map((entry) => entry.file),
      };
    })(),
    config: {
      appEnv: env.APP_ENV,
      postingMode: env.X_POSTING_MODE,
      appBaseUrl: env.APP_BASE_URL ?? null,
      actualOrigin: new URL(request.url).origin,
      stripeKeyKind: env.STRIPE_SECRET_KEY
        ? env.STRIPE_SECRET_KEY.startsWith("sk_live_")
          ? "live"
          : "test"
        : null,
      // DSNは**種別とホストだけ**を渡す（値は応答へ載せない・T-M8-162）。
      ...(() => {
        const server = classifySentryDsn(process.env.SENTRY_DSN);
        const browser = classifySentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
        return {
          sentryDsnKind: server.kind,
          sentryPublicDsnKind: browser.kind,
          sentryHost: server.host ?? browser.host,
        };
      })(),
    },
  });
  // 対応が必要な問題があれば5xxで返し、監視や `doctor` が判定しやすいようにする。
  return Response.json(report, { status: report.level === "error" ? 500 : 200 });
}

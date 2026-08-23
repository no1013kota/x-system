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
  const { buildStripeProbeDeps } = await import("@/lib/ops/stripe-probe-deps");
  const { env } = await import("@/lib/env");
  // 定時実行は本番でしか動かない。それ以外で「止まっている」と赤くしない（常に赤い表示は読まれなくなる）。
  const report = await collectDiagnostics(pooledQueryable(), {
    schedulerExpected: env.APP_ENV === "production",
    // 人間確認が実際に効いているかを、その環境自身のSupabaseへ問い合わせて確かめる（T-M7-53）。
    captcha: {
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    /*
      Stripe を見る検査（プラン管理・請求額・アカウント有効化・webhook購読）はまとめて作る
      （T-M8-247）。**毎朝の運営者アラートと同じ入口を使う**——以前はアラート側が1つも
      渡しておらず、設定済みなのに「未設定です」と毎日送っていた。
    */
    ...(await buildStripeProbeDeps()),
    // 確認メールの送信元（T-M8-147）。Supabase側の `smtp_user` と同じ値を設定している。
    mailSenderEmail: env.SMTP_USER ?? null,
    // 契約同期の鮮度は本番でだけ見る（ローカル・previewは stripe listen を常時動かさない）。
    subscriptionSyncExpected: env.APP_ENV === "production",
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

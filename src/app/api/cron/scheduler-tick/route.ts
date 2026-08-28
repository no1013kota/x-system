import { fiveMinWindowKey, runSchedulerTick } from "@/lib/jobs/cron";
import { handleCronRoute } from "@/lib/jobs/cron-route";

/** スケジューラtick（要件04 §1/§6/§7, ADR-0002）。5分間隔起動。 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  return handleCronRoute(request, {
    name: "scheduler_tick",
    windowKey: fiveMinWindowKey,
    work: async () => {
      // env は認証・受付通過後に遅延ロード（module読込で env 検証を走らせないため）。
      const { env } = await import("@/lib/env");
      const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
      const bucket = env.SUPABASE_STORAGE_BUCKET_IMAGES;
      return runSchedulerTick(undefined, {
        dailyLimit: env.X_DAILY_POST_LIMIT,
        quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
        imageBucket: bucket,
        removeStorageObjects: async (paths) => {
          await createSupabaseAdminClient().storage.from(bucket).remove(paths);
        },
        // doctorの判定を運営者へ1日1回届ける（T-M8-164）。宛先は SUPPORT_EMAIL のみ。
        runOperatorAlert: async ({ claimDay }) => {
          const [{ deliverOperatorAlert }, { sendOperatorMail }, { pooledQueryable }] =
            await Promise.all([
              import("@/lib/ops/operator-alert-server"),
              import("@/lib/email/operator-mail-server"),
              import("@/lib/db/pool"),
            ]);
          return deliverOperatorAlert({
            claimDay,
            db: pooledQueryable(),
            nowIso: new Date().toISOString(),
            sendMail: sendOperatorMail,
          });
        },
        // 招待報酬の確定と月次Payout（T-M8-174）。claimと本処理は同一トランザクション。
        runAffiliateBatch: async ({ claimTx }) => {
          const { runAffiliateBatch } = await import("@/lib/affiliate/cron-server");
          return runAffiliateBatch({ claimTx, nowIso: new Date().toISOString() });
        },
        // 契約期間の補完（T-M8-258）。null の契約者だけを Stripe から読む（1日1回・最大50件）。
        runPeriodBackfill: async ({ claimDay }) => {
          const jstDay = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
          if (!(await claimDay(jstDay))) return null;
          const [{ backfillSubscriptionPeriods }, { stripe }, { pooledQueryable }] = await Promise.all([
            import("@/lib/stripe/period-backfill"),
            import("@/lib/stripe/client"),
            import("@/lib/db/pool"),
          ]);
          return backfillSubscriptionPeriods({ db: pooledQueryable(), stripe, limit: 50 });
        },
        /*
          Xの連携を切らさない（T-M8-359・運営者の指示 2026-08-28）。1時間に1回、
          期限が近いtokenを先回りで更新する。**使わない日が続くとrefresh tokenが寝たまま
          古くなり、久しぶりに使ったときに要再連携になる**（T-M8-96）。
        */
        runXTokenRefresh: async ({ claimHour }) => {
          // JSTの「日付T時」で1時間に1回に絞る（cron_runs の window_key）。
          const jst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
          if (!(await claimHour(`${jst.slice(0, 13)}`))) return null;
          const [{ refreshDueXTokens }, { getValidXAccessToken }, { pooledQueryable }] =
            await Promise.all([
              import("@/lib/x/token-keepalive"),
              import("@/lib/x/token-refresh-server"),
              import("@/lib/db/pool"),
            ]);
          return refreshDueXTokens(
            pooledQueryable(),
            (xAccountId) => getValidXAccessToken(xAccountId),
            {
              // 失敗の中身（要再連携か一時エラーか）は getValidXAccessToken が状態と通知へ書く。
              onError: (id, err) => console.error(`[x_token_refresh] ${id}`, err),
            },
          );
        },
        // TODO: Sentry配線後は captureException へ。現状は運用ログのみ（tickを止めない）。
        onCleanupError: (scope, err) =>
          console.error(`[scheduler_tick cleanup] ${scope}`, err),
      });
    },
    response: ({ ran, windowKey, result }) => ({
      ok: true,
      ran,
      window: windowKey,
      ...(result ?? {}),
    }),
  });
}

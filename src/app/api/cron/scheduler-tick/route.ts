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
      const { sendNotificationEmailForId } = await import("@/lib/email/notification-email-server");
      const bucket = env.SUPABASE_STORAGE_BUCKET_IMAGES;
      return runSchedulerTick(undefined, {
        dailyLimit: env.X_DAILY_POST_LIMIT,
        quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
        imageBucket: bucket,
        removeStorageObjects: async (paths) => {
          await createSupabaseAdminClient().storage.from(bucket).remove(paths);
        },
        sendEmail: (id) => sendNotificationEmailForId(id),
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
        // TODO: Sentry配線後は captureException へ。現状は運用ログのみ（tickを止めない）。
        onCleanupError: (scope, err) =>
          console.error(`[scheduler_tick cleanup] ${scope}`, err),
        onEmailStaleWarning: (ageMs) =>
          console.warn(`[scheduler_tick email] oldest queued ${Math.round(ageMs / 60000)}min`),
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

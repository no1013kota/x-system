import { isValidCronAuth } from "@/lib/jobs/auth";
import {
  fiveMinWindowKey,
  runSchedulerTick,
  withCronWindowClaim,
} from "@/lib/jobs/cron";

/** スケジューラtick（要件04 §1/§6/§7, ADR-0002）。5分間隔起動。 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  // env は認証通過後に遅延ロード（module読込で env 検証を走らせないため）。
  const { env } = await import("@/lib/env");
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const bucket = env.SUPABASE_STORAGE_BUCKET_IMAGES;
  const windowKey = fiveMinWindowKey(new Date());
  const { ran, result } = await withCronWindowClaim("scheduler_tick", windowKey, () =>
    runSchedulerTick(undefined, {
      dailyLimit: env.X_DAILY_POST_LIMIT,
      quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
      imageBucket: bucket,
      removeStorageObjects: async (paths) => {
        await createSupabaseAdminClient().storage.from(bucket).remove(paths);
      },
      // TODO: Sentry配線後は captureException へ。現状は運用ログのみ（cleanup失敗はtickを止めない）。
      onCleanupError: (scope, err) =>
        console.error(`[scheduler_tick cleanup] ${scope}`, err),
    }),
  );
  return Response.json({ ok: true, ran, window: windowKey, ...(result ?? {}) });
}

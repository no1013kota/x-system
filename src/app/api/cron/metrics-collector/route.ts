import { isValidCronAuth } from "@/lib/jobs/auth";
import { hourWindowKey, withCronWindowLock } from "@/lib/jobs/cron";

/** 実績収集cron（要件04 §6/§13, K-1）。本処理（tweet_id別checkpoint更新）はM5で実装。 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const windowKey = hourWindowKey(new Date());
  const { ran } = await withCronWindowLock(
    "metrics_collector",
    windowKey,
    async () => {
      // TODO(M5): dueなtweet_idの1/7/30 checkpoint更新
    },
  );
  return Response.json({ ok: true, ran, window: windowKey });
}

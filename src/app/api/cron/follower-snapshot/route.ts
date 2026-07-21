import { isValidCronAuth } from "@/lib/jobs/auth";
import { hourWindowKey, withCronWindowClaim } from "@/lib/jobs/cron";

/** フォロワー数記録cron（要件04 §6/§13, K-4）。本処理（日次upsert）はM5で実装。 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const windowKey = hourWindowKey(new Date());
  const { ran } = await withCronWindowClaim(
    "follower_snapshot",
    windowKey,
    async () => {
      // TODO(M5): JST当日分がないactive Xアカウントのフォロワー数を保存
    },
  );
  return Response.json({ ok: true, ran, window: windowKey });
}

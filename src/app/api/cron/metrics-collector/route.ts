import { isValidCronAuth } from "@/lib/jobs/auth";
import { hourWindowKey, withCronWindowClaim } from "@/lib/jobs/cron";

/**
 * 実績収集cron（要件04 §6/§13, K-1, T-M5-12）。CRON_SECRET認証＋時間窓claimで二重起動時はno-op 2xx。
 * dueなdraftの未取得checkpoint（1/7/30日）をuser token別・最大100件/バッチで読み tweet_metrics へ保存し、
 * next_metrics_at を次dueへ前進する（上限=50 account・500 tweet_id、外部request最大10並列、残りは次回へ）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const windowKey = hourWindowKey(new Date());
  const { ran, result } = await withCronWindowClaim("metrics_collector", windowKey, async () => {
    // X token/env に触れるため認証・受付通過後に遅延ロードする（module読込で env 検証を走らせない）。
    const { runMetricsCollector } = await import("@/lib/jobs/metrics-collector-server");
    return runMetricsCollector(new Date());
  });
  return Response.json({ ok: true, ran, window: windowKey, result: result ?? null });
}

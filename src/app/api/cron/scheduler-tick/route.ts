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
  const windowKey = fiveMinWindowKey(new Date());
  const { ran, result } = await withCronWindowClaim(
    "scheduler_tick",
    windowKey,
    () => runSchedulerTick(),
  );
  return Response.json({ ok: true, ran, window: windowKey, ...(result ?? {}) });
}

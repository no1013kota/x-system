import { after } from "next/server";

import { isValidCronAuth } from "@/lib/jobs/auth";
import { runJob } from "@/lib/jobs/worker";

/**
 * Internal job dispatch endpoint (要件04 §1, 要件05 §3, ADR-0002).
 * "1 job = 1 worker Function呼び出し": authenticate with CRON_SECRET, return 202
 * immediately, and run the job in after() so the caller is not blocked.
 */
export const runtime = "nodejs"; // pg / node crypto は edge 不可
export const dynamic = "force-dynamic";
export const maxDuration = 200; // 要件01 §6 / ADR-0002

export async function POST(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = body?.jobId;
  if (typeof jobId !== "string" || jobId.length === 0) {
    return new Response("jobId required", { status: 400 });
  }
  // 202を即時返し、本処理はレスポンス後に実行する
  after(async () => {
    await runJob(jobId).catch(() => {
      // 失敗はrunJob内でjobをfailedにする。ここでは握りつぶす（呼び出し元は待たない）
    });
  });
  return new Response(null, { status: 202 });
}

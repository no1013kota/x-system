import { isValidCronAuth } from "@/lib/jobs/auth";

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
  });
  // 対応が必要な問題があれば5xxで返し、監視や `doctor` が判定しやすいようにする。
  return Response.json(report, { status: report.level === "error" ? 500 : 200 });
}

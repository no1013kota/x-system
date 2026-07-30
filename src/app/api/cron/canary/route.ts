import { isValidCronAuth } from "@/lib/jobs/auth";

/**
 * 実物スモーク（カナリア）の入口（T-M7-25）。
 *
 * **cron へは登録しない（`vercel.json` に crons を持たせない）。手動で叩いたときだけ動く。**
 * 実費が発生し生成枠も消費するため、定期実行にするかは別途判断する（BACKLOG D-11）。
 * `handleCronRoute` を使わないのはこのため（時間窓 claim は定期実行専用の仕組み）。
 *
 *   curl "<base>/api/cron/canary?xAccountId=<uuid>" -H "authorization: Bearer $CRON_SECRET"
 *
 * `xAccountId` 未指定ならニュースだけ検証する（本番で他人のアカウントを使わないため、
 * 生成対象は必ず呼び出し側が明示する）。作成した下書き・jobはシナリオ側で削除する。
 *
 * 判定は `src/lib/smoke/scenarios.ts` に集約し、`npm run smoke:live` と同じものを使う。
 * ローカルとデプロイ先で違う結果になるもの（env欠落・migration未適用・provider設定）は、
 * デプロイ先でこのrouteを叩いて初めて分かる。**ブラウザは起動しないのでCSP・署名URL・
 * 描画崩れは検出できない**（その環境を実際に開いて確認する）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const xAccountId = new URL(request.url).searchParams.get("xAccountId") ?? undefined;
  // env/provider解決に触れるため、認証通過後に遅延ロードする。
  const { runSmoke } = await import("@/lib/smoke/scenarios");
  const report = await runSmoke(xAccountId);
  // 失敗を5xxで返し、監視や `smoke:live` が判定しやすいようにする。
  return Response.json(report, { status: report.ok ? 200 : 500 });
}

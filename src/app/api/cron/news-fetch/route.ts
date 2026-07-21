import { isValidCronAuth } from "@/lib/jobs/auth";
import { hourWindowKey, withCronWindowLock } from "@/lib/jobs/cron";

/** ニュース取得cron（要件04 §6, N-1）。本処理（6分野リサーチ）はM4で実装。 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 200;

export async function GET(request: Request): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const windowKey = hourWindowKey(new Date());
  const { ran } = await withCronWindowLock("news_fetch", windowKey, async () => {
    // TODO(M4): 6分野をWebリサーチ→重複排除→時間単位ダイジェスト作成
  });
  return Response.json({ ok: true, ran, window: windowKey });
}

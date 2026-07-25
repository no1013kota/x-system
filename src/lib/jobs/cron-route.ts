import { isValidCronAuth } from "./auth";
import { withCronWindowClaim } from "./cron";

export interface CronRouteContext {
  /** 起動時刻（windowKey 算出と work で共有する単一の Date）。 */
  now: Date;
  windowKey: string;
}

export interface CronRouteResult<T> {
  ran: boolean;
  windowKey: string;
  /** claim できて work を実行したときのみ値を持つ（no-op 時は undefined）。 */
  result: T | undefined;
}

/**
 * 全 cron route 共通の受付枠（要件04 §6）。CRON_SECRET 認証（失敗は即 401）→ 時間窓 claim
 * （二重起動は no-op）→ 結果を JSON 応答にする一連を1箇所へ集約する。認証と claim の
 * 一貫性を担保し、新しい cron route が認証を書き忘れる事故を防ぐ。windowKey 種別（hour/5min）・
 * 本処理・応答 JSON の形は route ごとに与える（応答形は route 間で異なるため builder で渡す）。
 * work は claim 成立時のみ実行され、env/外部依存はここで遅延ロードしてよい。
 */
export async function handleCronRoute<T>(
  request: Request,
  opts: {
    name: string;
    windowKey: (now: Date) => string;
    work: (ctx: CronRouteContext) => Promise<T>;
    response: (result: CronRouteResult<T>) => unknown;
  },
): Promise<Response> {
  if (!isValidCronAuth(request.headers.get("authorization"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const now = new Date();
  const windowKey = opts.windowKey(now);
  const claim = await withCronWindowClaim(opts.name, windowKey, () =>
    opts.work({ now, windowKey }),
  );
  return Response.json(
    opts.response({
      ran: claim.ran,
      windowKey,
      result: claim.ran ? claim.result : undefined,
    }),
  );
}

import { type NextRequest, NextResponse } from "next/server";

import { getXAppCredentialsForUser } from "@/lib/api-key-store-server";
import { requireCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import type { PlanId } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  managedOAuthClient,
  sealState,
  X_OAUTH_STATE_COOKIE,
  xOAuthStateCookieOptions,
  xRedirectUri,
} from "@/lib/x/oauth-server";
import { buildXOAuthStart } from "@/lib/x/oauth-start";

/**
 * GET /api/x/oauth/start（T-M2-12, 要件05 §3/§4.3/§11）。認証済みユーザーの契約状態・plan上限・
 * 期待auth_typeを検証し、PKCE/stateを封緘したHttpOnly cookieを発行してX認可URLへredirectする。
 * 不足時（未契約・BYOKキー未登録・上限到達）は設定導線へredirectしエラーを提示する。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SETTINGS_PATH = "/app/settings?tab=api-keys";

/** open redirect 防止: 内部 `/app` 配下だけを returnPath として許可する。 */
function safeReturnPath(value: string | null): string | undefined {
  return value && value.startsWith("/app") ? value : undefined;
}

/** `?account=<id>` を本人所有の `x_user_id` へ解決する。指定なしは undefined（新規連携）。 */
async function resolveReconnectTarget(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  accountId: string | null,
): Promise<string | undefined> {
  if (!accountId) return undefined;
  const r = await admin
    .from("x_accounts")
    .select("x_user_id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) throw new AppError("not_found", { details: { reason: "x_account_not_found" } });
  return r.data.x_user_id as string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    userId = (await requireCurrentUser()).id;
    // eslint-disable-next-line no-restricted-syntax -- 未ログインは正常系。記録すると常時ノイズになる
  } catch {
    return NextResponse.redirect(
      new URL("/login?next=/app/settings", env.APP_BASE_URL as string),
    );
  }

  const admin = createSupabaseAdminClient();
  try {
    // `?account=<id>` は「この連携を再連携する」指定（T-M8-53）。**本人所有のものだけ**を受け付け、
    // 対象の `x_user_id` を state へ載せる。未知のIDは黙って無視せず新規連携として扱わない
    // （指定したのに新規追加されるのが元の不具合なので、指定が効かないなら止める）。
    const reconnectXUserId = await resolveReconnectTarget(
      admin,
      userId,
      request.nextUrl.searchParams.get("account"),
    );
    const result = await buildXOAuthStart(
      {
        userId,
        returnPath: safeReturnPath(request.nextUrl.searchParams.get("return")),
        ...(reconnectXUserId ? { reconnectXUserId } : {}),
      },
      {
        async getProfile(id) {
          const r = await admin
            .from("profiles")
            .select("plan, subscription_status")
            .eq("id", id)
            .maybeSingle();
          if (r.error) throw r.error;
          if (!r.data) return null;
          return {
            plan: r.data.plan as PlanId,
            subscriptionStatus: r.data.subscription_status as string,
          };
        },
        async getActiveXAccountCount(id) {
          const r = await admin
            .from("x_accounts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", id)
            .eq("status", "active");
          if (r.error) throw r.error;
          return r.count ?? 0;
        },
        getByokClient: getXAppCredentialsForUser,
        managedClient: managedOAuthClient,
        redirectUri: xRedirectUri(),
        sealState,
        now: Date.now,
      },
    );
    const response = NextResponse.redirect(result.authorizeUrl);
    response.cookies.set(
      X_OAUTH_STATE_COOKIE,
      result.sealedState,
      xOAuthStateCookieOptions(),
    );
    return response;
  } catch (error) {
    const { code, details } = toUserFacingError(error);
    // AppError 以外は internal_error に丸められ、原因が画面にもログにも残らず追跡できなくなる。
    // 想定外の失敗だけ記録する（AppError は仕様どおりの分岐なので記録しない）。
    if (code === "internal_error") {
      recordUnexpectedError(error, { at: "x-oauth-start" });
    }
    const settingsPath =
      (details?.settingsPath as string | undefined) ?? DEFAULT_SETTINGS_PATH;
    const to = new URL(settingsPath, env.APP_BASE_URL as string);
    to.searchParams.set("x_oauth_error", code);
    // reason は作者が定義した非機密の識別子。原因別の案内文を出すために渡す（要件06 §1.2.1）。
    if (typeof details?.reason === "string") {
      to.searchParams.set("x_oauth_reason", details.reason);
    }
    return NextResponse.redirect(to);
  }
}

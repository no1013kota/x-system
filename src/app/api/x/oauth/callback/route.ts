import { type NextRequest, NextResponse } from "next/server";

import { getXAppCredentialsForUser } from "@/lib/api-key-store-server";
import { requireCurrentUser } from "@/lib/auth/session";
import { withTransaction } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import { getMe } from "@/lib/x/client";
import { xClientDeps } from "@/lib/x/client-server";
import {
  handleXOAuthCallback,
  linkXAccountRecord,
} from "@/lib/x/oauth-callback";
import {
  exchangeCodeForToken,
  type FetchLike,
  type OAuthClient,
  type XAuthType,
} from "@/lib/x/oauth";
import {
  managedOAuthClient,
  sealTokens,
  verifyState,
  X_OAUTH_STATE_COOKIE,
  xOAuthStateCookieOptions,
  xRedirectUri,
} from "@/lib/x/oauth-server";

/**
 * GET /api/x/oauth/callback（T-M2-13）。state検証→session一致→code交換→scope確認→/2/users/me→
 * token暗号化保存＋x_accounts作成。成功はreturnPathへ、失敗は設定導線へredirect（秘密値・外部本文は返さない）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_PATH = "/app/settings?tab=api-keys";

const fetchLike: FetchLike = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body });

async function resolveOAuthClient(
  userId: string,
  authType: XAuthType,
): Promise<OAuthClient> {
  if (authType === "managed") return managedOAuthClient();
  const creds = await getXAppCredentialsForUser(userId);
  if (!creds) {
    throw new AppError("api_key_required", {
      details: { purpose: "x", settingsPath: SETTINGS_PATH },
    });
  }
  return {
    clientId: creds.clientId,
    clientSecret:
      creds.clientType === "confidential" && creds.clientSecret
        ? creds.clientSecret
        : undefined,
    redirectUri: xRedirectUri(),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let sessionUserId: string;
  try {
    sessionUserId = (await requireCurrentUser()).id;
    // eslint-disable-next-line no-restricted-syntax -- 未ログインは正常系。記録すると常時ノイズになる
  } catch {
    return NextResponse.redirect(
      new URL("/login?next=/app/settings", env.APP_BASE_URL as string),
    );
  }

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const sealedCookie = request.cookies.get(X_OAUTH_STATE_COOKIE)?.value;

  const clearStateCookie = (res: NextResponse): NextResponse => {
    res.cookies.set(X_OAUTH_STATE_COOKIE, "", {
      ...xOAuthStateCookieOptions(),
      maxAge: 0,
    });
    return res;
  };

  try {
    if (!code || !state) {
      // Xの拒否（?error=access_denied 等）・欠落は拒否系（詳細はT-M2-14）。設定導線へ戻す。
      throw new AppError("validation_error", {
        details: { reason: "missing_code_or_state", settingsPath: SETTINGS_PATH },
      });
    }
    const result = await handleXOAuthCallback(
      {
        code,
        returnedState: state,
        sealedStateCookie: sealedCookie,
        sessionUserId,
      },
      {
        verifyState,
        resolveClient: resolveOAuthClient,
        exchangeCode: (client, input) =>
          exchangeCodeForToken(client, input, { fetch: fetchLike }),
        fetchMe: async (accessToken) =>
          (await getMe(accessToken, xClientDeps())).user,
        sealTokens,
        persist: (record) =>
          withTransaction((client) => linkXAccountRecord(client, record)),
      },
    );
    const to = new URL(result.returnPath, env.APP_BASE_URL as string);
    to.searchParams.set("x_connected", "1");
    return clearStateCookie(NextResponse.redirect(to));
  } catch (error) {
    const { code: errorCode, details } = toUserFacingError(error);
    // AppError 以外は internal_error に丸められ、原因が画面にもログにも残らない（start routeと同様）。
    if (errorCode === "internal_error") {
      recordUnexpectedError(error, { at: "x-oauth-callback" });
    }
    const to = new URL(
      (details?.settingsPath as string | undefined) ?? SETTINGS_PATH,
      env.APP_BASE_URL as string,
    );
    to.searchParams.set("x_oauth_error", errorCode);
    // reason は作者が定義した非機密の識別子。原因別の案内文を出すために渡す（要件06 §1.2.1）。
    if (typeof details?.reason === "string") {
      to.searchParams.set("x_oauth_reason", details.reason);
    }
    return clearStateCookie(NextResponse.redirect(to));
  }
}

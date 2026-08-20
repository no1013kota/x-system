import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { routeGuardDestination } from "@/lib/auth/route-guard";
import { writeVerifiedUserHeaders } from "@/lib/auth/request-user";
import { getAppEncryptionKey } from "@/lib/crypto";
import { AppError } from "@/lib/observability/errors";
import { captureServerException } from "@/lib/observability/sentry";
import {
  applySecurityResponseHeaders,
  buildContentSecurityPolicy,
  generateNonce,
  isProdRuntime,
} from "@/lib/security-headers";

import { authCookieOptions, withAuthCookiePolicy } from "./cookie-options";

const SESSION_RESPONSE_HEADERS = ["cache-control", "expires", "pragma"];

type RouteGuardProfile = { plan: string | null; subscription_status: string };

/**
 * profile読み取りの連続失敗を記録するときの間隔（T-M8-159）。
 *
 * proxyは`/app`配下の**全リクエスト**で走るため、素直に毎回記録するとDB障害中に
 * 記録先が溢れて他の異常が埋まる。1分に1回へ落とす（失敗が続いていることは分かる）。
 */
const PROFILE_READ_FAILURE_LOG_INTERVAL_MS = 60_000;
let lastProfileReadFailureLoggedAt = 0;

/**
 * route-guard 判定に必要な plan/subscription_status を読む。判定は /app 配下でのみ
 * profile を要するため、未ログインや /app 以外のパスでは DB を叩かず null を返す。
 */
async function loadRouteGuardProfile(
  supabase: ReturnType<typeof createServerClient>,
  request: NextRequest,
  userId: string | null,
): Promise<RouteGuardProfile | null> {
  if (!userId) return null;
  const path = request.nextUrl.pathname;
  if (path !== "/app" && !path.startsWith("/app/")) return null;
  const result = await supabase
    .from("profiles")
    .select("plan, subscription_status")
    .eq("id", userId)
    .maybeSingle();
  if (result.error) {
    /*
      **失敗しても null を返す（fail closed のまま）。** `routeGuardDestination` は
      `!profile?.plan` で `/plans` へ送るため、DBが読めない間は誰も `/app` へ入れない。
      これは要件01の意図した向きなので変えない。**変えるのは「黙って起きる」ことだけ**——
      記録が無いと、運営者には「解約が急に増えた」ようにしか見えなかった（原則1）。

      ここで throw してはいけない。proxyは全リクエストを通るので、投げると
      `/app` 配下だけでなくログイン画面まで含めて全部が落ちる。
    */
    const now = Date.now();
    if (now - lastProfileReadFailureLoggedAt > PROFILE_READ_FAILURE_LOG_INTERVAL_MS) {
      lastProfileReadFailureLoggedAt = now;
      captureServerException(
        new AppError("internal_error", {
          cause: result.error,
          message: "Failed to read the route-guard profile; treating as no plan.",
        }),
        { path, reason: "route_guard_profile_read_failed" },
      );
    }
    return null;
  }
  return result.data;
}

function redirectWithSessionState(
  request: NextRequest,
  sessionResponse: NextResponse,
  destination: string,
): NextResponse {
  const redirectResponse = NextResponse.redirect(new URL(destination, request.url));
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  SESSION_RESPONSE_HEADERS.forEach((name) => {
    const value = sessionResponse.headers.get(name);
    if (value) redirectResponse.headers.set(name, value);
  });
  return redirectResponse;
}

/**
 * Refreshes the cookie-backed session before rendering and forwards the cache
 * headers required by @supabase/ssr when it rotates auth cookies.
 */
export async function updateSupabaseSession(request: NextRequest) {
  // セキュリティヘッダ／CSP（要件01 §8, T-M6-17）。nonce を request へ載せ Next.js に自身のscriptへ
  // 付与させる。forward するのは元cookie＋nonceで、rotate後の新cookieはブラウザへ response.cookies で送る。
  const isProd = isProdRuntime();
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce, isProd);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const cookiePolicy = authCookieOptions(env.APP_ENV);
  const cookiesToForward: Array<{
    name: string;
    options: CookieOptions;
    value: string;
  }> = [];
  const sessionHeaders = new Headers();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookieOptions: cookiePolicy,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            cookiesToForward.push({ name, value, options });
          });
          Object.entries(headersToSet).forEach(([name, value]) => {
            sessionHeaders.set(name, value);
          });
        },
      },
    },
  );

  // getUser validates the token with Supabase Auth; getSession only trusts the
  // cookie payload and must not be used for authorization decisions.
  const { data } = await supabase.auth.getUser();
  writeVerifiedUserHeaders(
    requestHeaders,
    data.user
      ? { id: data.user.id, email: data.user.email ?? null }
      : null,
    getAppEncryptionKey(),
  );
  // Forward the cookie value mutated during refresh to downstream Server Components.
  const refreshedCookie = request.cookies.toString();
  if (refreshedCookie) requestHeaders.set("cookie", refreshedCookie);
  else requestHeaders.delete("cookie");

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  cookiesToForward.forEach(({ name, value, options }) => {
    response.cookies.set(
      name,
      value,
      withAuthCookiePolicy(options, env.APP_ENV),
    );
  });
  sessionHeaders.forEach((value, name) => response.headers.set(name, value));
  const profile = await loadRouteGuardProfile(
    supabase,
    request,
    data.user?.id ?? null,
  );

  const destination = routeGuardDestination({
    profile,
    url: request.nextUrl,
    userId: data.user?.id ?? null,
  });
  const finalResponse = destination
    ? redirectWithSessionState(request, response, destination)
    : response;
  // CSP・nosniff・Referrer-Policy（prodはHSTS）を最終応答へ付与する（通常・リダイレクトの両経路）。
  applySecurityResponseHeaders(finalResponse.headers, csp, isProd);
  return finalResponse;
}

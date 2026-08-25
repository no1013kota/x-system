import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { routeGuardDestination } from "@/lib/auth/route-guard";
import { writeVerifiedUserHeaders } from "@/lib/auth/request-user";
import { getAppEncryptionKey } from "@/lib/crypto";
import {
  applySecurityResponseHeaders,
  buildContentSecurityPolicy,
  generateNonce,
  isProdRuntime,
} from "@/lib/security-headers";

import { authCookieOptions, withAuthCookiePolicy } from "./cookie-options";

const SESSION_RESPONSE_HEADERS = ["cache-control", "expires", "pragma"];

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
  /*
    **契約状態のためのDB読み取りをやめた**（T-M8-268）。以前は `/app` 配下の**全リクエスト**で
    profiles を1回SELECTしており、画面遷移のたびに往復が増えていた。判定が認証だけになった
    （契約で画面を弾かない）ので、proxyはDBに触れない。
  */
  const destination = routeGuardDestination({
    profile: null,
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

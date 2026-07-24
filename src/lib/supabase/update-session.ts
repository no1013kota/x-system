import "server-only";

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { routeGuardDestination } from "@/lib/auth/route-guard";
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

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const cookiePolicy = authCookieOptions(env.APP_ENV);

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

          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(
              name,
              value,
              withAuthCookiePolicy(options, env.APP_ENV),
            );
          });
          Object.entries(headersToSet).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );

  // getUser validates the token with Supabase Auth; getSession only trusts the
  // cookie payload and must not be used for authorization decisions.
  const { data } = await supabase.auth.getUser();
  let profile: { plan: string | null; subscription_status: string } | null = null;
  if (
    data.user &&
    (request.nextUrl.pathname === "/app" ||
      request.nextUrl.pathname.startsWith("/app/"))
  ) {
    const result = await supabase
      .from("profiles")
      .select("plan, subscription_status")
      .eq("id", data.user.id)
      .maybeSingle();
    profile = result.data;
  }

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

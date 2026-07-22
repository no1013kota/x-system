import "server-only";

import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

import { authCookieOptions, withAuthCookiePolicy } from "./cookie-options";

/**
 * Refreshes the cookie-backed session before rendering and forwards the cache
 * headers required by @supabase/ssr when it rotates auth cookies.
 */
export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
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

          response = NextResponse.next({ request });
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
  await supabase.auth.getUser();
  return response;
}

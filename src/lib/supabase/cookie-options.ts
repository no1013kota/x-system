import type { CookieOptions } from "@supabase/ssr";

import type { AppEnv } from "@/lib/env-schema";

/** Security attributes shared by every Supabase Auth session cookie. */
export function authCookieOptions(appEnv: AppEnv): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: appEnv === "production",
  };
}

/** Prevent caller-provided cookie options from weakening the required policy. */
export function withAuthCookiePolicy(
  options: CookieOptions,
  appEnv: AppEnv,
): CookieOptions {
  return {
    ...options,
    ...authCookieOptions(appEnv),
  };
}

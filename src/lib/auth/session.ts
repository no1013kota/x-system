import "server-only";

import { cache } from "react";

import type { User } from "@supabase/supabase-js";

import { AppError } from "@/lib/observability/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ensureUserProfile } from "./profile";
import { readCurrentUser } from "./session-core";

export { readCurrentUser } from "./session-core";

/**
 * Shared session check for Server Components, Server Actions, and API routes.
 *
 * Wrapped in React `cache()` (T-M8-67): layout と page が同じリクエスト内で両方呼ぶため、
 * 素のままだと auth.getUser() のHTTP往復とプロフィール修復が毎画面2回走っていた。
 * cache() はリクエスト内メモ化なので、鮮度の問題は起きない。
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const user = await readCurrentUser(supabase.auth);
  if (user) await ensureUserProfile(user);
  return user;
});

/** Fails closed with the stable API/Action error contract. */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("unauthorized");
  return user;
}

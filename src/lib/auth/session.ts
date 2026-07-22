import "server-only";

import type { User } from "@supabase/supabase-js";

import { AppError } from "@/lib/observability/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { readCurrentUser } from "./session-core";

export { readCurrentUser } from "./session-core";

/** Shared session check for Server Components, Server Actions, and API routes. */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  return readCurrentUser(supabase.auth);
}

/** Fails closed with the stable API/Action error contract. */
export async function requireCurrentUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("unauthorized");
  return user;
}

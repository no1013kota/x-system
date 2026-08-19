import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { AppError } from "@/lib/observability/errors";
import { getAppEncryptionKey } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  readVerifiedUserHeaders,
  type CurrentUser,
} from "./request-user";
import { readCurrentUser } from "./session-core";

export { readCurrentUser } from "./session-core";

/**
 * Shared session check for Server Components, Server Actions, and API routes.
 *
 * Reuses the signed identity verified by proxy in this request (T-M8-154). Calls without a
 * valid proxy context fall back to Supabase Auth. The proxy removes and overwrites incoming
 * context headers, and the HMAC prevents forged values from becoming an authorization source.
 * React `cache()` (T-M8-67) still deduplicates calls between a layout and its page.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const forwarded = readVerifiedUserHeaders(
    await headers(),
    getAppEncryptionKey(),
  );
  if (forwarded !== undefined) return forwarded;

  const supabase = await createSupabaseServerClient();
  const user = await readCurrentUser(supabase.auth);
  return user ? { id: user.id, email: user.email ?? null } : null;
});

/** Fails closed with the stable API/Action error contract. */
export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("unauthorized");
  return user;
}

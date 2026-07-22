import "server-only";

import type { User } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { ensureUserProfileWithClient } from "./profile-core";

/** Repairs a missing profile after authentication without modifying an existing row. */
export async function ensureUserProfile(user: User): Promise<void> {
  await ensureUserProfileWithClient(user, createSupabaseAdminClient());
}

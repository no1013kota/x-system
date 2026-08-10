import "server-only";

import type { User } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { ensureUserProfileWithClient } from "./profile-core";

/**
 * Repairs a missing profile after authentication without modifying an existing row.
 *
 * Read-first (T-M8-67): この関数は全ページ表示のホットパスに乗るため、正常系（行がある）を
 * 読み取り1回で済ませ、書き込み（upsert）は行が無いときだけ行う。修復の意味は変えない。
 */
export async function ensureUserProfile(user: User): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (data) return;
  await ensureUserProfileWithClient(user, admin);
}

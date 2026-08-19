import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  ensureUserProfileWithClient,
  type ProfileUser,
} from "./profile-core";

/**
 * Repairs a missing profile after authentication without modifying an existing row.
 *
 * Read-first (T-M8-67): signup確認完了・ログイン成功・plansの修復経路で、正常系（行がある）を
 * 読み取り1回で済ませ、書き込み（upsert）は行が無いときだけ行う（T-M8-154）。
 */
export async function ensureUserProfile(user: ProfileUser): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (data) return;
  await ensureUserProfileWithClient(user, admin);
}

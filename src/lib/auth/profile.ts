import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readSingleRow } from "@/lib/supabase/single-row";

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
  /*
    **読み取りの失敗を「行が無い」と混同しない**（T-M8-158/150）。以前は `const { data }` で
    error を捨てており、読めなかった場合も upsert 経路へ落ちていた。upsert自体は冪等なので
    データは壊れないが、`initialProfileForUser` は email が無いと throw するため、
    **読み取り障害が「プロフィール作成失敗」という別の例外に化けて**原因を追いにくかった。
    `/plans?confirmed=1` の500（T-M8-150）はこの経路上にある。
  */
  const existing = readSingleRow(
    await admin.from("profiles").select("id").eq("id", user.id).maybeSingle(),
    "profile repair lookup",
  );
  if (existing) return;
  await ensureUserProfileWithClient(user, admin);
}

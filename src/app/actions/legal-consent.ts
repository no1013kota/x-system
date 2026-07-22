"use server";

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/app/actions/auth-state";
import { requireCurrentUser } from "@/lib/auth/session";
import { acceptCurrentLegalConsents } from "@/lib/auth/legal-consent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function acceptLegalUpdates(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let state: AuthFormState;
  try {
    const user = await requireCurrentUser();
    const admin = createSupabaseAdminClient();
    const profile = await admin
      .from("profiles")
      .select(
        "terms_version, terms_accepted_at, privacy_version, privacy_acknowledged_at",
      )
      .eq("id", user.id)
      .single();
    if (profile.error || !profile.data) throw profile.error;
    state = await acceptCurrentLegalConsents(profile.data, formData, {
      now: () => new Date(),
      async updateProfile(update) {
        const result = await admin.from("profiles").update(update).eq("id", user.id);
        if (result.error) throw result.error;
      },
    });
  } catch {
    return {
      message: "同意内容を更新できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }
  if (state.status === "success") redirect("/app");
  return state;
}

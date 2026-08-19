import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_AI_PURPOSE_CONFIG,
  DEFAULT_NEWS_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
} from "@/lib/config-defaults";
import { AppError } from "@/lib/observability/errors";

export interface InitialProfile {
  id: string;
  email: string;
  plan: "standard";
  subscription_status: "incomplete";
  ai_purpose_config: typeof DEFAULT_AI_PURPOSE_CONFIG;
  news_config: typeof DEFAULT_NEWS_CONFIG;
  notification_config: typeof DEFAULT_NOTIFICATION_CONFIG;
}

/** Minimal Auth user projection required to initialize a profile. */
export interface ProfileUser {
  email?: string | null;
  id: string;
}

/** Builds the immutable defaults shared by the trigger and repair path. */
export function initialProfileForUser(user: ProfileUser): InitialProfile {
  if (!user.email) {
    throw new AppError("internal_error", {
      message: "An email address is required to create a profile.",
    });
  }

  return {
    id: user.id,
    email: user.email,
    plan: "standard",
    subscription_status: "incomplete",
    ai_purpose_config: DEFAULT_AI_PURPOSE_CONFIG,
    news_config: DEFAULT_NEWS_CONFIG,
    notification_config: DEFAULT_NOTIFICATION_CONFIG,
  };
}

/** Inserts a missing profile and leaves every existing value untouched. */
export async function ensureUserProfileWithClient(
  user: ProfileUser,
  admin: Pick<SupabaseClient, "from">,
): Promise<void> {
  const { error } = await admin.from("profiles").upsert(initialProfileForUser(user), {
    ignoreDuplicates: true,
    onConflict: "id",
  });

  if (error) {
    throw new AppError("internal_error", {
      cause: error,
      message: "Failed to ensure the user profile.",
    });
  }
}

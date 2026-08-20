import "server-only";

import { getXApiKeyStatusForUser } from "@/lib/app-banners-server";
import { LEGAL_CONSENT_SELECT } from "@/lib/auth/legal-consent";
import { env } from "@/lib/env";
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
} from "@/lib/notifications-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTodaysPostCount } from "@/lib/usage/daily-post-limit-server";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import {
  listXAccounts,
  resolveActiveXAccountForUser,
} from "@/lib/x/account-actions-server";

import {
  loadAppShellDataWithDependencies,
  type AppShellProfileRow,
} from "./data";

/** Connects the App Shell core to the production DB and server adapters. */
export async function loadAppShellData(userId: string) {
  const supabase = await createSupabaseServerClient();
  return loadAppShellDataWithDependencies(userId, {
    countUnreadNotifications: countUnreadNotificationsForUser,
    dailyPostLimit: env.X_DAILY_POST_LIMIT,
    getXApiKeyStatus: getXApiKeyStatusForUser,
    listNotifications: listNotificationsForUser,
    listXAccounts,
    loadProfile: async (id) => {
      const result = await supabase
        .from("profiles")
        .select(
          `plan, subscription_status, trial_ends_at, stripe_customer_id, ${LEGAL_CONSENT_SELECT}`,
        )
        .eq("id", id)
        .maybeSingle<AppShellProfileRow>();
      return result.data;
    },
    loadTodaysPostCount,
    loadUsageSummary: loadUsageSummaryForUser,
    resolveActiveXAccount: resolveActiveXAccountForUser,
  });
}

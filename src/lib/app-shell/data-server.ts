import "server-only";

import { env } from "@/lib/env";
import { listNotificationsForUser } from "@/lib/notifications-server";
import { loadTodaysPostCount } from "@/lib/usage/daily-post-limit-server";
import { usageSummaryFrom } from "@/lib/usage/usage-summary";
import {
  listXAccounts,
  resolveActiveXAccountForUser,
} from "@/lib/x/account-actions-server";

import { loadRequestProfile } from "@/lib/profile/request-profile-server";

import { loadAppShellDataWithDependencies } from "./data";

/**
 * Connects the App Shell core to the production DB and server adapters.
 *
 * **profile・Xキー状態・未読数・利用枠は1文にまとまっている**（T-M8-288・`loadRequestProfile`）。
 * port の形（4つの関数）は変えずに、中身を同じ1行から供給する——`cache()` 済みなので
 * 中核の `Promise.all` はそのままで、実際のDB往復は4本ではなく1本になる
 * （App Shell全体で 8往復 → 5往復。全 `/app` 遷移と `router.refresh()` のたびに効く）。
 */
export function loadAppShellData(userId: string) {
  return loadAppShellDataWithDependencies(userId, {
    countUnreadNotifications: async (id) => (await loadRequestProfile(id))?.unread_count ?? 0,
    dailyPostLimit: env.X_DAILY_POST_LIMIT,
    getXApiKeyStatus: async (id) => (await loadRequestProfile(id))?.x_api_key_status ?? null,
    listNotifications: listNotificationsForUser,
    listXAccounts,
    loadProfile: loadRequestProfile,
    loadTodaysPostCount,
    loadUsageSummary: async (id, plan) => {
      const bundle = await loadRequestProfile(id);
      return usageSummaryFrom(bundle, plan, bundle?.usage_resets_at ?? null);
    },
    resolveActiveXAccount: resolveActiveXAccountForUser,
  });
}

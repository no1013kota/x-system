import "server-only";

import { getXApiKeyStatusForUser } from "@/lib/app-banners-server";
import { env } from "@/lib/env";
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
} from "@/lib/notifications-server";
import { loadTodaysPostCount } from "@/lib/usage/daily-post-limit-server";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import {
  listXAccounts,
  resolveActiveXAccountForUser,
} from "@/lib/x/account-actions-server";

import { loadRequestProfile } from "@/lib/profile/request-profile-server";

import { loadAppShellDataWithDependencies } from "./data";

/** Connects the App Shell core to the production DB and server adapters. */
export function loadAppShellData(userId: string) {
  return loadAppShellDataWithDependencies(userId, {
    countUnreadNotifications: countUnreadNotificationsForUser,
    dailyPostLimit: env.X_DAILY_POST_LIMIT,
    getXApiKeyStatus: getXApiKeyStatusForUser,
    listNotifications: listNotificationsForUser,
    listXAccounts,
    loadProfile: loadRequestProfile,
    loadTodaysPostCount,
    loadUsageSummary: loadUsageSummaryForUser,
    resolveActiveXAccount: resolveActiveXAccountForUser,
  });
}

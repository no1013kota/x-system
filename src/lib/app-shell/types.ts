import type { AppBanner } from "@/lib/app-banners";
import type { SubscriptionBannerModel } from "@/lib/auth/subscription-access";
import type { NotificationView } from "@/lib/notifications";

/** Presentation data consumed by the shared App Shell. */
export interface AppShellSwitcherAccount {
  handle: string;
  id: string;
  profileImageUrl: string | null;
}

export interface AppShellData {
  activeAccountId: string | null;
  consentBanner: AppBanner | null;
  dailyPostBanner: AppBanner | null;
  notificationCursor: string | null;
  notifications: NotificationView[];
  stripeCustomerId: string | null;
  subscriptionBanner: SubscriptionBannerModel | null;
  switcherAccounts: AppShellSwitcherAccount[];
  unreadCount: number;
  usageBanner: AppBanner | null;
  xBanners: AppBanner[];
}

export function emptyAppShellData(): AppShellData {
  return {
    activeAccountId: null,
    consentBanner: null,
    dailyPostBanner: null,
    notificationCursor: null,
    notifications: [],
    stripeCustomerId: null,
    subscriptionBanner: null,
    switcherAccounts: [],
    unreadCount: 0,
    usageBanner: null,
    xBanners: [],
  };
}

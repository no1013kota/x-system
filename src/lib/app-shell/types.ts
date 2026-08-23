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
  /** 解約予約中か。契約バナーのPortalButtonの出し分けに使う（T-M8-57）。 */
  cancelAtPeriodEnd: boolean;
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
    cancelAtPeriodEnd: false,
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

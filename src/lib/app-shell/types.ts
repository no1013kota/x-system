import type { AppBanner } from "@/lib/app-banners";
import type { SubscriptionBannerModel } from "@/lib/auth/subscription-access";
import type { NotificationView } from "@/lib/notifications";

/** Presentation data consumed by the shared App Shell. */
export interface AppShellSwitcherAccount {
  handle: string;
  id: string;
  profileImageUrl: string | null;
}

/**
 * 操作対象のXアカウントを切り替えるServer Actionの形（T-M8-360）。
 *
 * **App Shellの型はここへ集める。** 以前は使われなくなったコンポーネント
 * （`x-account-switcher.tsx`）に置いたままで、**中身が消えた後も型のためだけに
 * ファイルが残っていた**。client componentは `@/app/actions/*` を直接importできない
 * （`dependency-boundaries.test.ts`）ので、この形をpropsで受け取る。
 */
export type SwitchAccountAction = (input: {
  x_account_id: string;
}) => Promise<{ message: string; status: "error" | "success" }>;

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

import {
  computeXAccountBanners,
  dailyPostLimitBanner,
  legalConsentBanner,
  usageLimitBanner,
  type AppBanner,
} from "@/lib/app-banners";
import {
  requiredLegalConsents,
  type LegalConsentProfile,
} from "@/lib/auth/legal-consent";
import { scheduledPlanChangeLabel } from "@/lib/billing/scheduled-plan-change";
import {
  subscriptionBannerFor,
  type SubscriptionBannerModel,
  type SubscriptionBannerProfile,
} from "@/lib/auth/subscription-access";
import type { NotificationPage } from "@/lib/notifications";
import type { PlanId } from "@/lib/plans";
import type { UsageSummary } from "@/lib/usage/usage-summary";
import type { XAccountListItem } from "@/lib/x/account-actions";

import type { AppShellData } from "./types";

export interface AppShellProfileRow extends LegalConsentProfile {
  plan: PlanId | null;
  stripe_customer_id: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  /** 期間末で切り替わる予約先のプラン（T-M8-260）。 */
  scheduled_plan: PlanId | null;
  scheduled_plan_at: string | null;
}

/** Ports required to assemble the App Shell without depending on DB or framework adapters. */
export interface AppShellDataDependencies {
  countUnreadNotifications(userId: string): Promise<number>;
  dailyPostLimit: number;
  getXApiKeyStatus(userId: string): Promise<string | null>;
  listNotifications(userId: string): Promise<NotificationPage>;
  listXAccounts(userId: string): Promise<XAccountListItem[]>;
  loadProfile(userId: string): Promise<AppShellProfileRow | null>;
  loadTodaysPostCount(xAccountId: string): Promise<number>;
  loadUsageSummary(userId: string, plan: PlanId): Promise<UsageSummary | null>;
  resolveActiveXAccount(userId: string): Promise<string | null>;
}

/**
 * Loads independent sources in one wave and converts them into the stable App Shell view model.
 * Framework clients and environment access stay in the server adapter.
 *
 * **user.id にしか依存しない取得は1波にまとめる**（T-M8-67）。以前は5段の直列awaitで、
 * App Shellは全画面の初回表示と操作後の `router.refresh()` のたびに再実行されるため、
 * 直列往復がそのまま全操作の体感遅延に乗っていた。
 */
export async function loadAppShellDataWithDependencies(
  userId: string,
  deps: AppShellDataDependencies,
): Promise<AppShellData> {
  const [
    activeAccountId,
    unreadCount,
    notificationPage,
    allAccounts,
    xApiKeyStatus,
    profileRow,
  ] = await Promise.all([
    // フォールバック規則で選択中Xアカウントを解決・永続化する（要件01 §5・T-M2-17）。
    deps.resolveActiveXAccount(userId),
    // ヘッダ通知ベル用の初期データ（未読数＋先頭ページ, T-M2-20）。
    deps.countUnreadNotifications(userId),
    deps.listNotifications(userId),
    deps.listXAccounts(userId),
    deps.getXApiKeyStatus(userId),
    deps.loadProfile(userId),
  ]);

  // 切替メニューには active なアカウントだけを出す（要件06 §2・T-M2-18）。
  const switcherAccounts = allAccounts
    .filter((account) => account.status === "active")
    .map((account) => ({
      handle: account.handle,
      id: account.id,
      profileImageUrl: account.profileImageUrl,
    }));

  let cancelAtPeriodEnd = false;
  let consentBanner: AppBanner | null = null;
  let dailyPostBanner: AppBanner | null = null;
  let stripeCustomerId: string | null = null;
  let subscriptionBanner: SubscriptionBannerModel | null = null;
  let usageBanner: AppBanner | null = null;
  let xBanners: AppBanner[] = [];

  if (profileRow) {
    // 規約・プライバシーの再同意（T-M8-134）。**プランに依存しないので `plan` 判定の外に置く**——
    // 中に入れると、プラン未設定の利用者だけ止まっている理由が画面に出なくなる。
    consentBanner = legalConsentBanner(requiredLegalConsents(profileRow));
    const subscriptionProfile: SubscriptionBannerProfile = {
      stripeCustomerId: profileRow.stripe_customer_id,
      subscriptionStatus: profileRow.subscription_status,
      trialEndsAt: profileRow.trial_ends_at,
      cancelAtPeriodEnd: profileRow.cancel_at_period_end,
      currentPeriodEnd: profileRow.current_period_end,
      scheduledPlanChange: scheduledPlanChangeLabel(profileRow),
    };
    stripeCustomerId = subscriptionProfile.stripeCustomerId;
    // バナーのPortalButtonが「解約する」/「解約予定を取り消す」を正しく出し分けるために渡す（T-M8-57）。
    cancelAtPeriodEnd = Boolean(profileRow.cancel_at_period_end);
    subscriptionBanner = subscriptionBannerFor(subscriptionProfile);

    if (profileRow.plan) {
      // X連携の常設バナー（失効/error・キー無効・プラン変更後の再連携要求, 要件06 §2・T-M2-21）。
      xBanners = computeXAccountBanners({
        plan: profileRow.plan,
        xAccounts: allAccounts.map((account) => ({
          authType: account.authType,
          status: account.status,
        })),
        xApiKeyStatus,
      });
      // 利用枠100%到達（premium・要件03 §8）と日次投稿上限（要決定D-15・T-M8-26。
      // **上限は選択中のアカウント単位**なので切り替えると別アカウントの状況が出る）の
      // 常設バナー。互いに独立なので並列に取得する。
      const [usageSummary, todaysPosts] = await Promise.all([
        deps.loadUsageSummary(userId, profileRow.plan),
        activeAccountId
          ? deps.loadTodaysPostCount(activeAccountId)
          : Promise.resolve(null),
      ]);
      usageBanner = usageLimitBanner(usageSummary);
      if (todaysPosts !== null) {
        dailyPostBanner = dailyPostLimitBanner({
          dailyLimit: deps.dailyPostLimit,
          todaysPosts,
        });
      }
    }
  }

  return {
    activeAccountId,
    cancelAtPeriodEnd,
    consentBanner,
    dailyPostBanner,
    notificationCursor: notificationPage.nextCursor,
    notifications: notificationPage.items,
    stripeCustomerId,
    subscriptionBanner,
    switcherAccounts,
    unreadCount,
    usageBanner,
    xBanners,
  };
}

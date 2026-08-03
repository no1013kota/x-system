import Link from "next/link";

import { AppNavigation } from "@/components/app-shell/app-navigation";
import { BrandLogo } from "@/components/app-shell/brand-logo";
import { CurrentScreenTitle } from "@/components/app-shell/current-screen-title";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { Icon } from "@/components/ui/icon";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import {
  computeXAccountBanners,
  dailyPostLimitBanner,
  usageLimitBanner,
  type AppBanner,
} from "@/lib/app-banners";
import { getXApiKeyStatusForUser } from "@/lib/app-banners-server";
import { loadTodaysPostCount } from "@/lib/usage/daily-post-limit-server";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import type { PlanId } from "@/lib/plans";
import { PortalButton } from "@/components/billing/portal-button";
import { LegalFooter } from "@/components/legal-footer";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import {
  subscriptionBannerFor,
  type SubscriptionBannerProfile,
} from "@/lib/auth/subscription-access";
import {
  XAccountSwitcher,
  type SwitcherAccount,
} from "@/components/app-shell/x-account-switcher";
import type { NotificationView } from "@/lib/notifications";
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
} from "@/lib/notifications-server";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listXAccounts,
  resolveActiveXAccountForUser,
} from "@/lib/x/account-actions-server";

interface AppShellProfileRow {
  plan: PlanId | null;
  stripe_customer_id: string | null;
  subscription_status: string;
  trial_ends_at: string | null;
}

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  let profile: SubscriptionBannerProfile | null = null;
  let activeAccountId: string | null = null;
  let switcherAccounts: SwitcherAccount[] = [];
  let unreadCount = 0;
  let notifications: NotificationView[] = [];
  let notificationCursor: string | null = null;
  let xBanners: AppBanner[] = [];
  let usageBanner: AppBanner | null = null;
  let dailyPostBanner: AppBanner | null = null;
  if (user) {
    // フォールバック規則で選択中Xアカウントを解決・永続化する（要件01 §5・T-M2-17）。
    activeAccountId = await resolveActiveXAccountForUser(user.id);
    // ヘッダ通知ベル用の初期データ（未読数＋先頭ページ, T-M2-20）。
    const [unread, page, allAccounts, xApiKeyStatus] = await Promise.all([
      countUnreadNotificationsForUser(user.id),
      listNotificationsForUser(user.id),
      listXAccounts(user.id),
      getXApiKeyStatusForUser(user.id),
    ]);
    unreadCount = unread;
    notifications = page.items;
    notificationCursor = page.nextCursor;
    // 切替メニューには active なアカウントだけを出す（要件06 §2・T-M2-18）。
    switcherAccounts = allAccounts
      .filter((account) => account.status === "active")
      .map((account) => ({
        id: account.id,
        handle: account.handle,
        profileImageUrl: account.profileImageUrl,
      }));
    const supabase = await createSupabaseServerClient();
    const result = await supabase
      .from("profiles")
      .select("plan, subscription_status, trial_ends_at, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle<AppShellProfileRow>();
    if (result.data) {
      profile = {
        stripeCustomerId: result.data.stripe_customer_id,
        subscriptionStatus: result.data.subscription_status,
        trialEndsAt: result.data.trial_ends_at,
      };
      // X連携の常設バナー（失効/error・キー無効・プラン変更後の再連携要求, 要件06 §2・T-M2-21）。
      if (result.data.plan) {
        xBanners = computeXAccountBanners({
          plan: result.data.plan,
          xAccounts: allAccounts.map((a) => ({
            status: a.status,
            authType: a.authType,
          })),
          xApiKeyStatus,
        });
        // 利用枠100%到達の常設バナー（premiumのみ・notification_config非依存, 要件03 §8・T-M6-13）。
        usageBanner = usageLimitBanner(
          await loadUsageSummaryForUser(user.id, result.data.plan),
        );
        // 日次投稿上限（全プラン共通・Xアカウント単位）に達したことの常設バナー
        // （要決定D-15・案A, T-M8-26）。**上限は選択中のアカウント単位**なので、
        // 切り替えると別のアカウントの状況が出る（それが正しい）。
        if (activeAccountId) {
          dailyPostBanner = dailyPostLimitBanner({
            todaysPosts: await loadTodaysPostCount(activeAccountId),
            dailyLimit: env.X_DAILY_POST_LIMIT,
          });
        }
      }
    }
  }
  const banner = profile ? subscriptionBannerFor(profile) : null;

  return (
    // 新デザインの骨格（T-M8-04）: サイドバー234px固定・ページ背景 #f6f6f7。
    // デスクトップ最適化だが、モバイルでは既存の下部タブバーへ落ちる構造を保つ。
    <div className="min-h-screen bg-page lg:flex">
      <aside className="sticky top-0 hidden h-screen w-[234px] shrink-0 flex-col border-r border-hairline bg-surface lg:flex">
        <div className="px-4 py-4">
          <BrandLogo />
        </div>
        {/*
          サイドバーに「料金プラン」は置かない（2026-08-03 ユーザー判断）。
          契約中の利用者の行き先は「設定 → 課金・プラン」で、そこに「プランを見る」がある。
          未契約の利用者はそもそも `/plans` に留められる（要件03 §2）ため、常設の導線は要らない。
        */}
        <AppNavigation />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-20 lg:pb-0">
        {/* トップバー54px。左=現在の画面名、右=通知・Xアカウント（デザイン §レイアウト骨格）。 */}
        <header className="sticky top-0 z-20 flex h-[54px] items-center gap-3 border-b border-hairline bg-surface px-4 lg:px-6">
          <BrandLogo className="lg:hidden" />
          <CurrentScreenTitle />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <XAccountSwitcher
              accounts={switcherAccounts}
              activeId={activeAccountId}
            />
            <NotificationBell
              initialCursor={notificationCursor}
              initialItems={notifications}
              initialUnread={unreadCount}
            />
            <Link
              aria-label="アカウント設定"
              className="inline-flex min-h-9 min-w-9 items-center justify-center gap-2 rounded-card px-2 text-sm font-medium text-ink-2 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href="/app/settings?tab=billing"
            >
              <Icon name="tune" size={18} />
              <span className="hidden md:inline">アカウント設定</span>
            </Link>
            <SignOutButton />
          </div>
        </header>

        {banner ? (
          <aside
            aria-label="ご契約のお知らせ"
            className={
              banner.tone === "warning"
                ? "border-b border-warn-fg/25 bg-warn-bg px-4 py-4 text-warn-fg"
                : "border-b border-info-fg/25 bg-info-bg px-4 py-3 text-info-fg"
            }
          >
            <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{banner.title}</p>
                <p className="mt-1 text-sm leading-5">{banner.description}</p>
              </div>
              {banner.action === "portal" ? (
                <PortalButton enabled={Boolean(profile?.stripeCustomerId)} />
              ) : null}
              {banner.action === "checkout" ? (
                <Link
                  className={`shrink-0 ${primaryLinkClassName}`}
                  href="/plans"
                >
                  プランを選択
                </Link>
              ) : null}
            </div>
          </aside>
        ) : null}

        {[...xBanners, ...(usageBanner ? [usageBanner] : []), ...(dailyPostBanner ? [dailyPostBanner] : [])].map((xBanner) => (
          <aside
            aria-label={xBanner.title}
            className="border-b border-warn-fg/25 bg-warn-bg px-4 py-4 text-warn-fg"
            key={xBanner.id}
          >
            <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{xBanner.title}</p>
                <p className="mt-1 text-sm leading-5">{xBanner.description}</p>
              </div>
              <Link
                className={`shrink-0 ${primaryLinkClassName}`}
                href={xBanner.actionHref}
              >
                {xBanner.actionLabel}
              </Link>
            </div>
          </aside>
        ))}

        {children}

        {/*
          法務3ページへの導線はApp Shellの最下部に1つ置く（T-M8-30）。
          以前は設定画面だけが自前で出していて、**設定以外の画面からは辿れない**うえ、
          中身が短いと画面の途中に浮いて見えた（`mt-auto` で最下部へ寄せる）。
        */}
        <LegalFooter className="mt-auto" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <AppNavigation mobile />
      </div>
    </div>
  );
}

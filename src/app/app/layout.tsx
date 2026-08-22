import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import {
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import { setActiveXAccountAction } from "@/app/actions/x-accounts";
import { AppNavigation } from "@/components/app-shell/app-navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { CurrentScreenTitle } from "@/components/app-shell/current-screen-title";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { SignOutButton } from "@/components/app-shell/sign-out-button";
import { XAccountSwitcher } from "@/components/app-shell/x-account-switcher";
import { PortalButton } from "@/components/billing/portal-button";
import { LegalFooter } from "@/components/legal-footer";
import { Icon } from "@/components/ui/icon";
import { primaryLinkClassName } from "@/components/ui/link-button";
import {
  emptyAppShellData,
  type AppShellData,
} from "@/lib/app-shell/types";
import { loadAppShellData } from "@/lib/app-shell/data-server";
import { getCurrentUser } from "@/lib/auth/session";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  const shell: AppShellData = user
    ? await loadAppShellData(user.id)
    : emptyAppShellData();
  const {
    activeAccountId,
    consentBanner,
    dailyPostBanner,
    notificationCursor,
    notifications,
    stripeCustomerId,
    subscriptionBanner: banner,
    switcherAccounts,
    unreadCount,
    usageBanner,
    xBanners,
  } = shell;

  return (
    // 新デザインの骨格（T-M8-04）: サイドバー234px固定・ページ背景 #f6f6f7。
    // デスクトップ最適化だが、モバイルでは既存の下部タブバーへ落ちる構造を保つ。
    <div className="min-h-screen bg-page lg:flex">
      <aside className="sticky top-0 hidden h-screen w-[234px] shrink-0 flex-col border-r border-hairline bg-surface lg:flex">
        <div className="px-4 py-4">
          <BrandLogo priority />
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
          <BrandLogo className="lg:hidden" priority />
          <CurrentScreenTitle />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <XAccountSwitcher
              accounts={switcherAccounts}
              activeId={activeAccountId}
              switchAccountAction={setActiveXAccountAction}
            />
            <NotificationBell
              initialCursor={notificationCursor}
              initialItems={notifications}
              initialUnread={unreadCount}
              listNotificationsAction={listNotificationsAction}
              markAllNotificationsReadAction={markAllNotificationsReadAction}
              markNotificationReadAction={markNotificationReadAction}
            />
            <Link
              aria-label="設定"
              className="inline-flex min-h-9 min-w-9 items-center justify-center gap-2 rounded-card px-2 text-sm font-medium text-ink-2 hover:bg-black/[0.03] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              // 先頭タブ（設定）へ入る。以前は課金・プランを指していたが、ヘッダの「設定」から
              // 課金画面が開くのは行き先の予想と違う（2026-08-18 運営者の指示・T-M8-126）。
              href="/app/settings"
            >
              <Icon name="tune" size={18} />
              <span className="hidden md:inline">設定</span>
            </Link>
            <SignOutButton signOutAction={signOut} />
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
                <PortalButton enabled={Boolean(stripeCustomerId)} />
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

        {[
          // 再同意は**実行が全部止まっている**状態なので先頭に出す。
          ...(consentBanner ? [consentBanner] : []),
          ...xBanners,
          ...(usageBanner ? [usageBanner] : []),
          ...(dailyPostBanner ? [dailyPostBanner] : []),
        ].map((xBanner) => (
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

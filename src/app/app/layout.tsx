import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import {
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import { setActiveXAccountAction } from "@/app/actions/x-accounts";
import { AccountMenu } from "@/components/app-shell/account-menu";
import { ACCOUNT_MENU_SETTINGS_LINKS } from "@/app/app/settings/tabs";
import { AppNavigation } from "@/components/app-shell/app-navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { PortalButton } from "@/components/billing/portal-button";
import { LegalFooter } from "@/components/legal-footer";
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
    cancelAtPeriodEnd,
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

        {/*
          **ヘッダーを廃止したので、その導線をここへ集めた**（T-M8-328・運営者の指示 2026-08-27）。
          お知らせとアカウント（Xアカウント切替・設定の各タブ・ログアウト）を最下部に置く。
          設定はナビの1枠を使うほど毎日触るものではないため、アカウントの中へ畳んだ。
        */}
        <div className="mt-auto space-y-1 border-t border-hairline p-2">
          <NotificationBell
            initialCursor={notificationCursor}
            initialItems={notifications}
            initialUnread={unreadCount}
            listNotificationsAction={listNotificationsAction}
            markAllNotificationsReadAction={markAllNotificationsReadAction}
            markNotificationReadAction={markNotificationReadAction}
            sidebar
          />
          <AccountMenu
            accounts={switcherAccounts}
            activeId={activeAccountId}
            settingsLinks={ACCOUNT_MENU_SETTINGS_LINKS}
            signOutAction={signOut}
            switchAccountAction={setActiveXAccountAction}
          />
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-36 lg:pb-0">

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
                // 解約予約中に「解約する」を出さない（T-M8-57。バナー本文の「取り消しができます」と
                // ボタンが食い違っていた——cancelAtPeriodEnd を渡し忘れると再発する）。
                <PortalButton
                  cancelAtPeriodEnd={cancelAtPeriodEnd}
                  enabled={Boolean(stripeCustomerId)}
                />
              ) : null}
              {banner.action === "billing" ? (
                <Link
                  className={`shrink-0 ${primaryLinkClassName}`}
                  href="/app/settings?tab=billing"
                >
                  課金・プランを確認
                </Link>
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

      {/*
        モバイル: ヘッダーを廃止したので、お知らせとアカウントを下部バーの上段へ置く
        （T-M8-328）。ナビは7枠が上限なので同じ行には入れない。
      */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="flex items-center gap-1 border-b border-hairline px-2 py-1">
          <BrandLogo className="mr-auto" priority />
          <NotificationBell
            initialCursor={notificationCursor}
            initialItems={notifications}
            initialUnread={unreadCount}
            listNotificationsAction={listNotificationsAction}
            markAllNotificationsReadAction={markAllNotificationsReadAction}
            markNotificationReadAction={markNotificationReadAction}
          />
          <div className="w-[190px]">
            <AccountMenu
              accounts={switcherAccounts}
              activeId={activeAccountId}
              settingsLinks={ACCOUNT_MENU_SETTINGS_LINKS}
              signOutAction={signOut}
              switchAccountAction={setActiveXAccountAction}
            />
          </div>
        </div>
        <div className="px-1">
          <AppNavigation mobile />
        </div>
      </div>
    </div>
  );
}

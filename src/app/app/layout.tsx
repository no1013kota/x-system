import { Bell, Settings } from "lucide-react";
import Link from "next/link";

import { AppNavigation } from "@/components/app-shell/app-navigation";
import { PortalButton } from "@/components/billing/portal-button";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import {
  subscriptionBannerFor,
  type SubscriptionBannerProfile,
} from "@/lib/auth/subscription-access";
import {
  XAccountSwitcher,
  type SwitcherAccount,
} from "@/components/app-shell/x-account-switcher";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listXAccounts,
  resolveActiveXAccountForUser,
} from "@/lib/x/account-actions-server";

interface AppShellProfileRow {
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
  if (user) {
    // フォールバック規則で選択中Xアカウントを解決・永続化する（要件01 §5・T-M2-17）。
    activeAccountId = await resolveActiveXAccountForUser(user.id);
    // 切替メニューには active なアカウントだけを出す（要件06 §2・T-M2-18）。
    switcherAccounts = (await listXAccounts(user.id))
      .filter((account) => account.status === "active")
      .map((account) => ({
        id: account.id,
        handle: account.handle,
        profileImageUrl: account.profileImageUrl,
      }));
    const supabase = await createSupabaseServerClient();
    const result = await supabase
      .from("profiles")
      .select("subscription_status, trial_ends_at, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle<AppShellProfileRow>();
    if (result.data) {
      profile = {
        stripeCustomerId: result.data.stripe_customer_id,
        subscriptionStatus: result.data.subscription_status,
        trialEndsAt: result.data.trial_ends_at,
      };
    }
  }
  const banner = profile ? subscriptionBannerFor(profile) : null;

  return (
    <div className="min-h-screen bg-muted/30 lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-sidebar lg:block">
        <Link
          className="mx-6 my-6 inline-flex rounded-md text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          href="/app"
        >
          {APP_NAME}
        </Link>
        <AppNavigation />
      </aside>

      <div className="min-w-0 flex-1 pb-20 lg:pb-0">
        <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <Link
              className="rounded-md font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring lg:hidden"
              href="/app"
            >
              {APP_NAME}
            </Link>
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <XAccountSwitcher
                accounts={switcherAccounts}
                activeId={activeAccountId}
              />
              <Link
                aria-label="通知"
                className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href="/app#notifications"
              >
                <Bell aria-hidden="true" className="size-5" />
              </Link>
              <Link
                aria-label="アカウント設定"
                className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href="/app/settings?tab=billing"
              >
                <Settings aria-hidden="true" className="size-5" />
                <span className="hidden md:inline">アカウント設定</span>
              </Link>
            </div>
          </div>
        </header>

        {banner ? (
          <aside
            aria-label="ご契約のお知らせ"
            className={
              banner.tone === "warning"
                ? "border-b border-amber-300 bg-amber-50 px-4 py-4 text-amber-950"
                : "border-b border-sky-200 bg-sky-50 px-4 py-3 text-sky-950"
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
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  href="/plans"
                >
                  プランを選択
                </Link>
              ) : null}
            </div>
          </aside>
        ) : null}

        {children}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <AppNavigation mobile />
      </div>
    </div>
  );
}

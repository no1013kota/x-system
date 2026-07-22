import Link from "next/link";

import { PortalButton } from "@/components/billing/portal-button";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import {
  subscriptionBannerFor,
  type SubscriptionBannerProfile,
} from "@/lib/auth/subscription-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  let profile: SubscriptionBannerProfile | null = null;
  if (user) {
    const admin = createSupabaseAdminClient();
    const result = await admin
      .from("profiles")
      .select("subscription_status, trial_ends_at, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle<{
        stripe_customer_id: string | null;
        subscription_status: string;
        trial_ends_at: string | null;
      }>();
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
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link className="font-semibold" href="/app">
            {APP_NAME}
          </Link>
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            href="/app/settings?tab=billing"
          >
            アカウント設定
          </Link>
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
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
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
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { PortalButton } from "@/components/billing/portal-button";
import { env } from "@/lib/env";
import { PLANS, type PlanId } from "@/lib/plans";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: `アカウント設定 | ${APP_NAME}`,
};

interface SettingsPageProps {
  searchParams: Promise<{ portal?: string; tab?: string }>;
}

interface BillingProfile {
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  plan: PlanId | null;
  stripe_customer_id: string | null;
  subscription_status: string;
}

const STATUS_LABELS: Record<string, string> = {
  incomplete: "お申し込み未完了",
  incomplete_expired: "お申し込み期限切れ",
  trialing: "無料トライアル中",
  active: "有効",
  past_due: "お支払い確認中",
  unpaid: "お支払い停止",
  paused: "一時停止",
  canceled: "解約済み",
};

function formatPeriodEnd(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login?next=/app/settings%3Ftab%3Dbilling");

  const tab = params.tab === "support" ? "support" : "billing";
  const admin = createSupabaseAdminClient();
  const result = await admin
    .from("profiles")
    .select(
      "plan, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id",
    )
    .eq("id", user.id)
    .maybeSingle<BillingProfile>();
  if (result.error || !result.data) {
    throw new Error("Billing profile could not be loaded.");
  }
  const profile = result.data;

  return (
    <main className="px-4 py-8 lg:px-8 lg:py-10">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">アカウント設定</h1>
          <p className="text-sm text-muted-foreground">
            ご契約内容の確認とお問い合わせができます。
          </p>
        </header>

        <nav aria-label="設定タブ" className="flex gap-2 border-b">
          {[
            ["billing", "課金・プラン"],
            ["support", "問い合わせ"],
          ].map(([slug, label]) => (
            <Link
              aria-current={tab === slug ? "page" : undefined}
              className={`border-b-2 px-4 py-3 text-sm font-medium ${
                tab === slug
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground"
              }`}
              href={`/app/settings?tab=${slug}`}
              key={slug}
            >
              {label}
            </Link>
          ))}
        </nav>

        {tab === "billing" ? (
          <section className="space-y-6" aria-labelledby="billing-heading">
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h2 className="text-xl font-semibold" id="billing-heading">
                現在のご契約
              </h2>
              {params.portal === "return" ? (
                <p
                  className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
                  role="status"
                >
                  お支払い管理画面から戻りました。契約情報を確認しています。
                </p>
              ) : null}
              <dl className="mt-6 grid gap-5 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">プラン</dt>
                  <dd className="mt-1 text-lg font-semibold">
                    {profile.plan ? PLANS[profile.plan].displayName : "未選択"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">契約状態</dt>
                  <dd className="mt-1 text-lg font-semibold">
                    {STATUS_LABELS[profile.subscription_status] ??
                      profile.subscription_status}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">現在の期間終了日</dt>
                  <dd className="mt-1 font-medium">
                    {formatPeriodEnd(profile.current_period_end)}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">解約予定</dt>
                  <dd className="mt-1 font-medium">
                    {profile.cancel_at_period_end
                      ? "期間終了日に解約予定"
                      : "解約予定なし"}
                  </dd>
                </div>
              </dl>
              <div className="mt-7 flex flex-wrap items-start gap-3">
                <PortalButton enabled={Boolean(profile.stripe_customer_id)} />
                <Link
                  className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
                  href="/plans"
                >
                  プランを見る
                </Link>
              </div>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              プラン変更、お支払い方法の更新、期間末解約はStripeの安全なお支払い管理画面で行います。変更内容はStripeからの通知後に反映されます。
            </p>
          </section>
        ) : (
          <section
            aria-labelledby="support-heading"
            className="rounded-2xl border bg-card p-6 shadow-sm"
          >
            <h2 className="text-xl font-semibold" id="support-heading">
              お問い合わせ
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              課金、アカウント、データに関するお問い合わせはメールで受け付けています。
            </p>
            <a
              className="mt-5 inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
              href={`mailto:${env.SUPPORT_EMAIL}`}
            >
              {env.SUPPORT_EMAIL}へメール
            </a>
          </section>
        )}
      </div>
    </main>
  );
}

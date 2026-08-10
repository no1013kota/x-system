import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { TabNav } from "@/components/app-shell/tab-nav";
import { XOAuthErrorNotice } from "@/components/app-shell/x-oauth-error-notice";
import { PortalButton } from "@/components/billing/portal-button";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { env } from "@/lib/env";
import type { ApiKeyViewState } from "@/lib/api-key-view";
import { listApiKeyViewsForUser } from "@/lib/api-key-view-server";
import { PLANS, type PlanId } from "@/lib/plans";
import { getSettingsForUser } from "@/lib/settings-server";
import type { UserSettings } from "@/lib/settings";
import { UsageSummaryCard } from "@/components/app-shell/usage-summary-card";
import { formatNextMonthStartJst, type UsageSummary } from "@/lib/usage/usage-summary";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listXAccounts,
  type XAccountListItem,
} from "@/lib/x/account-actions-server";

import { ApiKeySettings } from "./api-key-settings";
import { SettingsPreferences } from "./settings-preferences";
import { SETTINGS_TABS } from "./tabs";
import { XAccountsSettings } from "./x-accounts-settings";
import { Card, CardTitle, cardClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { planChangeEffects } from "@/lib/billing/plan-change-effects";
import { xRedirectUri } from "@/lib/x/oauth-server";

export const metadata: Metadata = {
  title: `アカウント設定 | ${APP_NAME}`,
};

interface SettingsPageProps {
  searchParams: Promise<{
    portal?: string;
    tab?: string;
    x_connected?: string;
    x_oauth_error?: string;
    x_oauth_reason?: string;
  }>;
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

  const tab = SETTINGS_TABS.some(([slug]) => slug === params.tab)
    ? params.tab ?? "billing"
    : "billing";
  const admin = createSupabaseAdminClient();
  // profile取得と、planに依存しないタブ別データは1波にまとめる（T-M8-67。以前は最大4段直列）。
  const [result, xAccounts, userSettings] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "plan, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id",
      )
      .eq("id", user.id)
      .maybeSingle<BillingProfile>(),
    tab === "x-accounts" ? listXAccounts(user.id) : Promise.resolve([] as XAccountListItem[]),
    tab === "notifications"
      ? getSettingsForUser(user.id)
      : Promise.resolve(null as UserSettings | null),
  ]);
  if (result.error || !result.data) {
    throw new Error("Billing profile could not be loaded.");
  }
  const profile = result.data;
  // planに依存する2つは第2波で並列に。
  // - APIキー: BYOK（standard/md）はX APIキーの登録がX連携の前提なので、Xアカウントタブでも
  //   登録状況を読む（前提未達のまま「追加」を押して無言で戻される事故を防ぐ・要件06 §1.2.1）。
  // - 利用枠: premium 月間利用枠の残量（課金・プランタブとAPIキータブ, 要件03 §8・T-M6-12/T-M8-25）。
  const [apiKeys, usage] = await Promise.all([
    (tab === "api-keys" || tab === "x-accounts") && profile.plan !== "premium"
      ? listApiKeyViewsForUser(user.id)
      : Promise.resolve([] as ApiKeyViewState[]),
    tab === "billing" || tab === "api-keys"
      ? loadUsageSummaryForUser(user.id, profile.plan ?? "standard")
      : Promise.resolve(null as UsageSummary | null),
  ]);

  return (
    <main className="px-4 py-[26px] lg:px-8">
      <div className="mx-auto max-w-[1180px] space-y-3.5">
        <header>
          <h1 className="text-[20px] font-bold tracking-tight text-ink">設定</h1>
          {/* 管理項目の列挙はタブラベルと同じ情報なので書かない（T-M8-66）。 */}
          <p className="mt-1 text-body text-ink-2">
            発信の内容に関わる設定は
            <Link className="mx-1 font-medium text-brand underline-offset-2 hover:underline" href="/app/ai-settings">
              AI設定
            </Link>
            にあります。
          </p>
        </header>

        <TabNav
          active={tab}
          hrefFor={(slug) => `/app/settings?tab=${slug}`}
          items={SETTINGS_TABS.map(([value, label]) => ({ value, label }))}
          label="設定タブ"
        />

        {/* X連携の失敗は戻り先がAPIキータブになることもあるため、タブに依らず先頭で表示する。 */}
        {params.x_oauth_error ? (
          <XOAuthErrorNotice
            code={params.x_oauth_error}
            reason={params.x_oauth_reason ?? null}
          />
        ) : null}

        {tab === "x-accounts" ? (
          <XAccountsSettings
            accounts={xAccounts}
            connected={params.x_connected === "1"}
            oauthStartPath={`/api/x/oauth/start?return=${encodeURIComponent(
              "/app/settings?tab=x-accounts",
            )}`}
            plan={profile.plan ?? "standard"}
            xApiKeyRegistered={
              profile.plan === "premium" ||
              apiKeys.some((key) => key.provider === "x")
            }
          />
        ) : tab === "api-keys" ? (
          <ApiKeySettings
            // **OAuthが実際に送る値と同じ関数から取る**（T-M8-58）。式を二重に書くと、片方だけ
            // 変えたときに「Consoleへ登録した表示値」と「実送信値」が食い違い、Xは完全一致で
            // 照合するため連携が全滅する——この画面が防ごうとしている事故そのもの。
            callbackUrl={xRedirectUri()}
            initialKeys={apiKeys}
            plan={profile.plan ?? "standard"}
            usage={usage}
            usageResetLabel={formatNextMonthStartJst(new Date())}
          />
        ) : tab === "notifications" && userSettings ? (
          <SettingsPreferences
            newsConfig={userSettings.newsConfig}
            notificationConfig={userSettings.notificationConfig}
          />
        ) : tab === "billing" ? (
          <section className="space-y-6" aria-labelledby="billing-heading">
            <Card as="div" className="px-5 py-4">
              <CardTitle id="billing-heading">
                現在のご契約
              </CardTitle>
              {params.portal === "return" ? (
                // 反映待ちの説明は「実際に待ちが起きるこの瞬間」だけに出す（T-M8-66）。
                <Notice className="mt-4" tone="success"
                  role="status">
                  お支払い管理画面から戻りました。変更は数十秒ほどでこの画面に反映されます。
                </Notice>
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
              {/*
                導線は1つにする（T-M8-29）。`PortalButton` が契約状態で行き先を変える
                （契約中→Stripeのプラン管理／契約前→料金プラン）ので、`/plans` への
                別リンクを並べると同じ行き先が2つ出る。
              */}
              <div className="mt-7">
                <PortalButton
                  cancelAtPeriodEnd={Boolean(profile.cancel_at_period_end)}
                  effects={planChangeEffects({
                    cancelAtPeriodEnd: Boolean(profile.cancel_at_period_end),
                    currentPeriodEnd: profile.current_period_end,
                    subscriptionStatus: profile.subscription_status,
                  })}
                  enabled={Boolean(profile.stripe_customer_id)}
                />
              </div>
            </Card>
            {usage ? (
              <UsageSummaryCard nextResetLabel={formatNextMonthStartJst(new Date())} summary={usage} />
            ) : null}
          </section>
        ) : (
          <section
            aria-labelledby="support-heading"
            className={`${cardClassName} px-5 py-4`}
          >
            <CardTitle id="support-heading">
              お問い合わせ
            </CardTitle>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              課金、アカウント、データに関するお問い合わせはメールで受け付けています。
            </p>
            <a
              className={`mt-5 ${primaryLinkClassName}`}
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

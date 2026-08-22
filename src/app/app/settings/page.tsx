import type { Metadata } from "next";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";
import { redirect } from "next/navigation";

import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { yen } from "@/lib/format";
import { serverNowMs } from "@/lib/time/server-now";
import { EmptyState, LockedState } from "@/components/app-shell/page-state";
import { TabNav } from "@/components/app-shell/tab-nav";
import { UpgradePlanButton } from "@/components/billing/upgrade-plan-button";
import { XOAuthErrorNotice } from "@/components/app-shell/x-oauth-error-notice";
import { PortalButton } from "@/components/billing/portal-button";
import type { AiKeyProvider } from "@/lib/api-keys";
import type { ApiKeyViewState } from "@/lib/api-key-view";
import { listApiKeyViewsForUser } from "@/lib/api-key-view-server";
import { operatorImageProviders } from "@/lib/ai-purpose-config-server";
import type { BaseMdVersionView } from "@/lib/base-md";
import {
  isLearningRunningForUser,
  listBaseMdVersionsForUser,
} from "@/lib/base-md-server";
import type { LearningSourceView } from "@/lib/learning-sources";
import { listLearningSourcesForUser } from "@/lib/learning-sources-server";
import {
  DEFAULT_TONE_SETTINGS,
  baseMdSettingsDiffer,
  personaSettingsSchema,
  type PersonaSettings,
} from "@/lib/persona-settings";
import { isOperatorManagedPlan, PLANS, type PlanId } from "@/lib/plans";
import type { PromptTemplateView } from "@/lib/prompts/prompt-templates";
import { listPromptTemplatesForUser } from "@/lib/prompts/prompt-templates-server";
import { listPatternsForUser } from "@/lib/post/post-patterns-server";
import type { PatternOption, PatternPromptView } from "@/lib/post/post-patterns-store";
import { SYSTEM_DEFAULT_TEMPLATES, type PromptTemplateKind } from "@/lib/prompts/gen-prompts";
import { getSettingsForUser } from "@/lib/settings-server";
import type { UserSettings } from "@/lib/settings";
import { UsageSummaryCard } from "@/components/app-shell/usage-summary-card";
import { formatNextMonthStartJst, type UsageSummary } from "@/lib/usage/usage-summary";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import { readSingleRow } from "@/lib/supabase/single-row";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listXAccounts,
  type XAccountListItem,
} from "@/lib/x/account-actions-server";

import { AiPurposeSettings } from "./ai-purpose-settings";
import { ApiKeySettings } from "./api-key-settings";
import { BaseMdEditor } from "./base-md-editor";
import { LearningSourcesManager } from "./learning-sources-manager";
import { PersonaSettingsForm } from "./persona-settings-form";
import { PatternManager } from "./pattern-manager";
import { PromptTemplatesEditor } from "./prompt-templates-editor";
import { SettingsPreferences } from "./settings-preferences";
import {
  PROMPT_SECTIONS,
  SETTINGS_TABS,
  normalizePromptSection,
  normalizeSettingsTab,
} from "./tabs";
import { XAccountsSettings } from "./x-accounts-settings";
import { Card, CardTitle, pageTitleClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { planChangeEffects } from "@/lib/billing/plan-change-effects";
import { xRedirectUri } from "@/lib/x/oauth-server";

/**
 * 設定（T-M8-104で旧「設定」と旧「AI設定」を統合）。タブ構成:
 * 設定（Xアカウント＋APIキー＋通知）／課金・プラン／アカウント設定（＋参考ソース）／
 * AIモデル設定／プロンプト（アカウント.md・投稿作成・画像生成）。
 * 問い合わせタブは廃止（2026-08-15 運営者の指示）。旧slugは tabs.ts のエイリアスが受ける。
 */

export const metadata: Metadata = {
  title: `設定 | ${APP_NAME}`,
};

const EMPTY_SETTINGS: PersonaSettings = {
  ng: { rules: [], topics: [], words: [] },
  persona: { audience: "", speaker: "", value: "" },
  themes: { free_text: "", primary: [], secondary: [] },
  tone: { ...DEFAULT_TONE_SETTINGS },
};

interface SettingsPageProps {
  searchParams: Promise<{
    portal?: string;
    sec?: string;
    tab?: string;
    x_connected?: string;
    x_oauth_error?: string;
    x_oauth_reason?: string;
  }>;
}

interface BillingProfile {
  active_x_account_id: string | null;
  ai_purpose_config: unknown;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  /** ログイン中のメールアドレス（T-M8-95。どのアカウントで入っているかを確認できるように出す）。 */
  email: string | null;
  plan: PlanId | null;
  stripe_customer_id: string | null;
  subscription_status: string;
}

interface AccountRow {
  base_md: string;
  base_md_version: number;
  handle: string;
  id: string;
  settings: unknown;
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

/** アカウント設定・プロンプトタブの共通前提: 操作対象のXアカウント。無ければ連携導線を出す。 */
function NoAccountState() {
  return (
    <EmptyState
      actionHref="/app/settings?tab=general"
      actionLabel="Xアカウント設定へ"
      description="アカウント設定は連携済みのXアカウントごとに保存されます。"
      title="Xアカウントを選択してください"
    />
  );
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login?next=/app/settings");

  const tab = normalizeSettingsTab(params.tab);
  const promptSection = normalizePromptSection(params.sec);
  const admin = createSupabaseAdminClient();
  // profile取得と、planに依存しないタブ別データは1波にまとめる（T-M8-67。以前は最大4段直列）。
  const [result, xAccounts, userSettings] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "active_x_account_id, ai_purpose_config, email, plan, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id",
      )
      .eq("id", user.id)
      .maybeSingle<BillingProfile>(),
    tab === "general" ? listXAccounts(user.id) : Promise.resolve([] as XAccountListItem[]),
    tab === "general"
      ? getSettingsForUser(user.id)
      : Promise.resolve(null as UserSettings | null),
  ]);
  if (result.error || !result.data) {
    throw new Error("Billing profile could not be loaded.");
  }
  const profile = result.data;
  /*
    未契約(null)は route-guard により billing タブ以外へ来ない。以前は `?? "standard"` で
    最も権限の狭いプランへ倒していたが、新standardは編集権限を持つ（T-M8-168）ため
    null のまま扱い、各判定関数（promptEditablePlan / isOperatorManagedPlan）が false を返す。
  */
  const plan: PlanId | null = profile.plan;
  // Portalセッションを作れるか。無いあいだは `/plans` へ送る（T-M8-89）。
  const hasStripeCustomer = Boolean(profile.stripe_customer_id);

  // planに依存する第2波。
  // - APIキー: BYOK（standard/md）はX APIキーの登録がX連携の前提なので、設定タブで一緒に読む
  //   （前提未達のまま「追加」を押して無言で戻される事故を防ぐ・要件06 §1.2.1）。
  // - 利用枠: premium 月間利用枠の残量（設定タブ・課金タブ, 要件03 §8・T-M6-12/T-M8-25）。
  // - アカウント行: アカウント設定／プロンプトタブの対象Xアカウント。
  const [apiKeys, usage, accountResult, purposeKeys] = await Promise.all([
    tab === "general" && !isOperatorManagedPlan(plan)
      ? listApiKeyViewsForUser(user.id)
      : Promise.resolve([] as ApiKeyViewState[]),
    tab === "billing" || tab === "general"
      ? loadUsageSummaryForUser(user.id, plan ?? "")
      : Promise.resolve(null as UsageSummary | null),
    (tab === "account" || tab === "prompts") && profile.active_x_account_id
      ? admin
          .from("x_accounts")
          .select("id, handle, settings, base_md, base_md_version")
          .eq("id", profile.active_x_account_id)
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle<AccountRow>()
      : Promise.resolve(null),
    tab === "purposes" && !isOperatorManagedPlan(plan)
      ? listApiKeyViewsForUser(user.id)
      : Promise.resolve(null),
  ]);
  // 取得失敗を「未選択」にしない（T-M8-158）。null へ潰すと、連携済み・選択済みの利用者へ
  // 「Xアカウントを選択してください」の空状態が出て行き止まりになる。
  const account: AccountRow | null = accountResult
    ? readSingleRow(accountResult, "settings x_account")
    : null;
  // 参考ソースの滞留判定に使う基準時刻（T-M8-113）。サーバーとブラウザで同じ値を使わないと
  // ちょうど60秒あたりで判定が割れ、表示が食い違って描き直しになる。
  const nowMs = await serverNowMs();

  // アカウント設定タブ: 保存済み設定と、アカウント.mdとの差分有無・参考ソース。
  const parsedSettings = account ? personaSettingsSchema.safeParse(account.settings) : null;
  const initialSettings = parsedSettings?.success ? parsedSettings.data : EMPTY_SETTINGS;
  let initialDifference = false;
  if (account && account.base_md_version >= 1 && parsedSettings?.success) {
    try {
      initialDifference = baseMdSettingsDiffer(account.base_md, parsedSettings.data);
    } catch {
      initialDifference = true;
    }
  }
  // 参考ソースはアカウント設定タブの一番下に置く（T-M8-103）。
  let learningSources: LearningSourceView[] = [];
  if (tab === "account" && account && account.base_md_version >= 1) {
    learningSources = await listLearningSourcesForUser(user.id, account.id);
  }

  // プロンプトタブ: アカウント.md（履歴・学習中表示）とテンプレート。
  let baseMdHistory: BaseMdVersionView[] = [];
  let baseMdLearningRunning = false;
  if (
    tab === "prompts" &&
    promptSection === "account-md" &&
    account &&
    promptEditablePlan(plan ?? "") &&
    account.base_md_version >= 1
  ) {
    [baseMdHistory, baseMdLearningRunning] = await Promise.all([
      listBaseMdVersionsForUser(user.id, account.id),
      isLearningRunningForUser(user.id, account.id),
    ]);
  }
let promptTemplates: PromptTemplateView[] = [];
  /** 投稿作成プロンプト＝パターン管理（T-M8-129 U4b）。プルダウンをやめ全件並べる。 */
  let patterns: PatternOption[] = [];
  let patternPrompts: Record<string, PatternPromptView> = {};
  let systemDefaultPrompts: Record<string, string> = {};
  if (tab === "prompts" && promptSection !== "account-md" && account && promptEditablePlan(plan ?? "")) {
    if (promptSection === "image-prompt") {
      const res = await listPromptTemplatesForUser(user.id);
      promptTemplates = res.templates.filter((tpl) => tpl.kind === "image");
    } else {
      const res = await listPatternsForUser(user.id);
      patterns = res.patterns;
      patternPrompts = res.prompts;
      // 「プロンプトを既定に戻す」の比較元。既定パターンだけが持つ。
      systemDefaultPrompts = Object.fromEntries(
        res.patterns
          .filter((option) => option.isSystemDefault && option.seedKey !== null)
          .map((option) => [
            option.id,
            SYSTEM_DEFAULT_TEMPLATES[option.seedKey as PromptTemplateKind] ?? "",
          ]),
      );
    }
  }
  let validUserProviders: AiKeyProvider[] = [];
  if (purposeKeys) {
    validUserProviders = purposeKeys
      .filter(
        (key): key is typeof key & { provider: AiKeyProvider } =>
          key.provider !== "x" && key.status === "valid",
      )
      .map((key) => key.provider);
  }

  return (
    <main className="px-4 py-[26px] lg:px-8">
      <div className="mx-auto max-w-[1180px] space-y-3.5">
        <header>
          <h1 className={pageTitleClassName}>設定</h1>
        </header>

        <TabNav
          active={tab}
          className="gap-1 overflow-x-auto"
          hrefFor={(slug) => `/app/settings?tab=${slug}`}
          items={SETTINGS_TABS.map(([value, label]) => ({ value, label }))}
          label="設定タブ"
          linkClassName="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        />

        {/* X連携の失敗は戻り先が設定タブになるため、タブに依らず先頭で表示する。 */}
        {params.x_oauth_error ? (
          <XOAuthErrorNotice
            code={params.x_oauth_error}
            reason={params.x_oauth_reason ?? null}
          />
        ) : null}

        {tab === "general" ? (
          <div className="space-y-8">
            {/* どのアカウントでログインしているか（T-M8-95→T-M8-109で設定タブ先頭へ移動・運営者の指示）。
                確認メール・領収書の宛先でもある。 */}
            <p className="text-body text-ink-2">
              ログイン中のアカウント:{" "}
              <span className="font-medium text-ink">{profile.email ?? user.email ?? "不明"}</span>
            </p>
            {/* 旧・Xアカウント／APIキー／通知タブを1タブへ（T-M8-104）。
                各部品が自前の見出しを持つため、ここでは見出しを重ねない（重複headingはE2EのstrictモードとAT読み上げの両方を壊す）。 */}
            <XAccountsSettings
                accounts={xAccounts}
                connected={params.x_connected === "1"}
                oauthStartPath={`/api/x/oauth/start?return=${encodeURIComponent(
                  "/app/settings?tab=general",
                )}`}
                plan={plan}
                xApiKeyRegistered={
                  isOperatorManagedPlan(plan) || apiKeys.some((key) => key.provider === "x")
                }
              />
            <ApiKeySettings
                // **OAuthが実際に送る値と同じ関数から取る**（T-M8-58）。式を二重に書くと、片方だけ
                // 変えたときに「Consoleへ登録した表示値」と「実送信値」が食い違い、Xは完全一致で
                // 照合するため連携が全滅する——この画面が防ごうとしている事故そのもの。
                callbackUrl={xRedirectUri()}
                initialKeys={apiKeys}
                plan={plan}
                usage={usage}
                usageResetLabel={formatNextMonthStartJst(new Date())}
              />
            {userSettings ? (
              <SettingsPreferences
                newsConfig={userSettings.newsConfig}
                notificationConfig={userSettings.notificationConfig}
              />
            ) : null}
          </div>
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
                  <dt className="text-caption text-ink-3">プラン</dt>
                  {/* 月額はプラン名の真横（右側）に出し、キャンペーン終了後の併記は置かない
                      （運営者の指示 2026-08-22）。 */}
                  <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 text-body font-bold">
                    {profile.plan ? PLANS[profile.plan].displayName : "未選択"}
                    {profile.plan ? (
                      <span className="text-caption font-normal text-ink-3">
                        月額 ¥{yen(PLANS[profile.plan].monthlyPriceJpy)}（税込）
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-3">契約状態</dt>
                  <dd className="mt-1 text-body font-bold">
                    {STATUS_LABELS[profile.subscription_status] ??
                      profile.subscription_status}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-3">現在の期間終了日</dt>
                  <dd className="mt-1 text-body font-bold">
                    {formatPeriodEnd(profile.current_period_end)}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-3">解約予定</dt>
                  <dd className="mt-1 text-body font-bold">
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
                  enabled={hasStripeCustomer}
                />
              </div>
            </Card>
            {usage ? (
              <UsageSummaryCard nextResetLabel={formatNextMonthStartJst(new Date())} summary={usage} />
            ) : null}
          </section>
        ) : tab === "account" ? (
          !account ? (
            <NoAccountState />
          ) : (
            <div className="space-y-8">
              <PersonaSettingsForm
                accountHandle={account.handle}
                baseMdVersion={account.base_md_version}
                initialDifference={initialDifference}
                initialSettings={initialSettings}
                // アカウント切替でstateを捨てる（前アカウントの内容を新アカウントへ保存させない・T-M8-196）。
                key={account.id}
                xAccountId={account.id}
              />
              {/* 参考ソースは学習の反映先（アカウント.md）ができてから出す（T-M8-103）。 */}
              {account.base_md_version >= 1 ? (
                <LearningSourcesManager
                  initialNowMs={nowMs}
                  initialSources={learningSources}
                  xAccountId={account.id}
                />
              ) : null}
            </div>
          )
        ) : tab === "purposes" ? (
          <AiPurposeSettings
            initialConfig={
              (profile.ai_purpose_config as { image: string | null; text: string | null } | null) ?? {
                image: null,
                text: null,
              }
            }
            operatorImageProviders={[...operatorImageProviders()]}
            plan={plan}
            validUserProviders={validUserProviders}
          />
        ) : !promptEditablePlan(plan ?? "") ? (
          // プロンプトタブは全プランで編集可（T-M8-168）。未契約（plan NULL）だけロックする。
          <LockedState
            action={<UpgradePlanButton enabled={hasStripeCustomer} />}
            description="学習・設定の結果はアカウント.mdに反映され、投稿生成に使われています。ご契約中のプランでは内容とプロンプトを直接確認・編集できます。"
            title="アカウント.md・プロンプトの確認・編集にはご契約が必要です"
          />
        ) : !account ? (
          <NoAccountState />
        ) : (
          <div className="space-y-4">
            {/* プロンプトタブ内の区分（T-M8-104）。アカウント.mdを一番左に置く。 */}
            <TabNav
              active={promptSection}
              hrefFor={(slug) => `/app/settings?tab=prompts&sec=${slug}`}
              items={PROMPT_SECTIONS.map(([value, label]) => ({ value, label }))}
              label="プロンプトの区分"
            />
            {account.base_md_version < 1 ? (
              <EmptyState
                actionHref="/app/settings?tab=account"
                actionLabel="アカウント設定へ"
                description="編集対象のアカウント.mdを、先にアカウント設定から保存してください。"
                title="先にアカウント設定を保存してください"
              />
            ) : promptSection === "account-md" ? (
              <BaseMdEditor
                initialContent={account.base_md}
                initialHistory={baseMdHistory}
                initialVersion={account.base_md_version}
                // アカウント切替でstateを捨てる（実ブラウザ再現: 切替後もtextareaが前アカウントの本文のまま
                // 保存でき、別アカウントのアカウント.mdを上書きできた・T-M8-196）。
                key={account.id}
                learningRunning={baseMdLearningRunning}
                xAccountId={account.id}
              />
            ) : promptSection === "image-prompt" ? (
              <PromptTemplatesEditor
                initialTemplates={promptTemplates}
                // アカウント切替でstateを確実に捨てる（前アカウントの本文を持ち越さない・T-M8-196）。
                key={`${promptSection}:${account.id}`}
                xAccountId={account.id}
              />
            ) : (
              <PatternManager
                initialPatterns={patterns}
                initialPrompts={patternPrompts}
                key={`${promptSection}:${account.id}`}
                systemDefaultPrompts={systemDefaultPrompts}
                xAccountId={account.id}
              />
            )}
          </div>
        )}
      </div>
    </main>
  );
}

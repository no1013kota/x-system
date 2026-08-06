import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyState, LockedState } from "@/components/app-shell/page-state";
import { PLANS } from "@/lib/plans";
import { TabNav } from "@/components/app-shell/tab-nav";
import { APP_NAME } from "@/lib/app-config";
import type { AiKeyProvider } from "@/lib/api-keys";
import { listApiKeyViewsForUser } from "@/lib/api-key-view-server";
import { operatorImageProviders } from "@/lib/ai-purpose-config-server";
import { getCurrentUser } from "@/lib/auth/session";
import {
  DEFAULT_TONE_SETTINGS,
  baseMdSettingsDiffer,
  personaSettingsSchema,
  type PersonaSettings,
} from "@/lib/persona-settings";
import {
  listLearningSourcesForUser,
  ownPostsReimportEligibilityForAccount,
} from "@/lib/learning-sources-server";
import type { LearningSourceView } from "@/lib/learning-sources";
import {
  isLearningRunningForUser,
  listBaseMdVersionsForUser,
} from "@/lib/base-md-server";
import type { BaseMdVersionView } from "@/lib/base-md";
import { listPromptTemplatesForUser } from "@/lib/prompts/prompt-templates-server";
import type { PromptTemplateView } from "@/lib/prompts/prompt-templates";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AiPurposeSettings } from "./ai-purpose-settings";
import { BaseMdEditor } from "./base-md-editor";
import { AI_SETTINGS_TABS } from "./tabs";
import { LearningSourcesManager } from "./learning-sources-manager";
import { PersonaSettingsForm } from "./persona-settings-form";
import { PromptTemplatesEditor } from "./prompt-templates-editor";

export const metadata: Metadata = { title: `AI設定 | ${APP_NAME}` };

const EMPTY_SETTINGS: PersonaSettings = {
  ng: { rules: [], topics: [], words: [] },
  persona: { audience: "", speaker: "", value: "" },
  themes: { free_text: "", primary: [], secondary: [] },
  tone: { ...DEFAULT_TONE_SETTINGS },
};

interface AiSettingsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

interface AccountRow {
  base_md: string;
  base_md_version: number;
  handle: string;
  id: string;
  settings: unknown;
}

interface ProfileRow {
  active_x_account_id: string | null;
  ai_purpose_config: unknown;
  plan: "md" | "premium" | "standard";
}

export default async function AiSettingsPage({
  searchParams,
}: AiSettingsPageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login?next=/app/ai-settings");
  const tab = AI_SETTINGS_TABS.some(([value]) => value === params.tab)
    ? params.tab ?? "persona"
    : "persona";
  const supabase = await createSupabaseServerClient();
  const profile = await supabase
    .from("profiles")
    .select("active_x_account_id, ai_purpose_config, plan")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();
  const planForKeys = profile.data?.plan ?? "standard";
  // アカウント行とAI用途タブのキー一覧は互いに独立なので並列に取る（T-M8-67）。
  const [accountResult, purposeKeys] = await Promise.all([
    profile.data?.active_x_account_id
      ? supabase
          .from("x_accounts")
          .select("id, handle, settings, base_md, base_md_version")
          .eq("id", profile.data.active_x_account_id)
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle<AccountRow>()
      : Promise.resolve(null),
    tab === "purposes" && planForKeys !== "premium"
      ? listApiKeyViewsForUser(user.id)
      : Promise.resolve(null),
  ]);
  const account: AccountRow | null = accountResult?.data ?? null;

  const parsedSettings = account
    ? personaSettingsSchema.safeParse(account.settings)
    : null;
  const initialSettings = parsedSettings?.success
    ? parsedSettings.data
    : EMPTY_SETTINGS;
  let initialDifference = false;
  if (account && account.base_md_version >= 1 && parsedSettings?.success) {
    try {
      initialDifference = baseMdSettingsDiffer(
        account.base_md,
        parsedSettings.data,
      );
    } catch {
      initialDifference = true;
    }
  }

  const plan = profile.data?.plan ?? "standard";
  let learningSources: LearningSourceView[] = [];
  let ownPostsNextEligibleAt: string | null = null;
  if (tab === "learning" && account) {
    [learningSources, { nextEligibleAt: ownPostsNextEligibleAt }] = await Promise.all([
      listLearningSourcesForUser(user.id, account.id),
      ownPostsReimportEligibilityForAccount(account.id),
    ]);
  }
  let baseMdHistory: BaseMdVersionView[] = [];
  let baseMdLearningRunning = false;
  if (tab === "base-md" && account && plan !== "standard" && account.base_md_version >= 1) {
    [baseMdHistory, baseMdLearningRunning] = await Promise.all([
      listBaseMdVersionsForUser(user.id, account.id),
      isLearningRunningForUser(user.id, account.id),
    ]);
  }
  let promptTemplates: PromptTemplateView[] = [];
  let promptQuoteEnabled = false;
  if (tab === "prompts" && account && plan !== "standard") {
    const res = await listPromptTemplatesForUser(user.id);
    promptTemplates = res.templates;
    promptQuoteEnabled = res.quotePostEnabled;
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
    <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
      <header>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">AI設定</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-ink-2">
          AIがあなたの代わりに投稿を書くための設定です。まず「発信設定」→「AI用途」の順に設定してください。
        </p>
      </header>

      <TabNav
        active={tab}
        className="mt-7 gap-1 overflow-x-auto"
        hrefFor={(value) => `/app/ai-settings?tab=${value}`}
        inactiveLinkClassName="hover:text-foreground"
        items={AI_SETTINGS_TABS.map(([value, label]) => ({ value, label }))}
        label="AI設定タブ"
        linkClassName="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      />

      <div className="mt-7">
        {tab === "purposes" ? (
          <AiPurposeSettings
            initialConfig={profile.data?.ai_purpose_config ?? { image: null, text: null }}
            operatorImageProviders={[...operatorImageProviders()]}
            plan={plan}
            validUserProviders={validUserProviders}
          />
        ) : !account ? (
          <EmptyState
            actionHref="/app/settings?tab=x-accounts"
            actionLabel="Xアカウント設定へ"
            description="発信設定は連携済みのXアカウントごとに保存されます。"
            title="Xアカウントを選択してください"
          />
        ) : tab === "persona" ? (
          <PersonaSettingsForm
            accountHandle={account.handle}
            baseMdVersion={account.base_md_version}
            initialDifference={initialDifference}
            initialSettings={initialSettings}
            xAccountId={account.id}
          />
        ) : tab === "learning" ? (
          account.base_md_version < 1 ? (
            <EmptyState
              actionHref="/app/ai-settings?tab=persona"
              actionLabel="発信設定へ"
              description="学習の反映先となるベースmdを、先に発信設定から保存してください。"
              title="先に発信設定を保存してください"
            />
          ) : (
            <LearningSourcesManager
              initialOwnPostsNextEligibleAt={ownPostsNextEligibleAt}
              initialSources={learningSources}
              plan={plan}
              xAccountId={account.id}
            />
          )
        ) : tab === "base-md" ? (
          plan === "standard" ? (
            <LockedState
              actionHref="/plans"
              actionLabel={`mdプランにアップグレード（¥${PLANS.md.monthlyPriceJpy.toLocaleString()}/月）`}
              description="学習・設定の結果はベースmdに反映され、投稿生成に使われています。mdプラン以上では内容を直接確認・編集でき、変更履歴からいつでも元に戻せます。"
              title="ベースmdの確認・編集は mdプラン以上でご利用いただけます"
            />
          ) : account.base_md_version < 1 ? (
            <EmptyState
              actionHref="/app/ai-settings?tab=persona"
              actionLabel="発信設定へ"
              description="編集対象のベースmdを、先に発信設定から保存してください。"
              title="先に発信設定を保存してください"
            />
          ) : (
            <BaseMdEditor
              initialContent={account.base_md}
              initialHistory={baseMdHistory}
              initialVersion={account.base_md_version}
              learningRunning={baseMdLearningRunning}
              xAccountId={account.id}
            />
          )
        ) : tab === "prompts" ? (
          plan === "standard" ? (
            <LockedState
              actionHref="/plans"
              actionLabel={`mdプランにアップグレード（¥${PLANS.md.monthlyPriceJpy.toLocaleString()}/月）`}
              description="投稿パターンごとのプロンプトを直接編集できます。いつでもシステム既定に戻せます。"
              title="プロンプトのカスタマイズは mdプラン以上でご利用いただけます"
            />
          ) : (
            <PromptTemplatesEditor
              initialTemplates={promptTemplates}
              quotePostEnabled={promptQuoteEnabled}
            />
          )
        ) : (
          <EmptyState
            description="このタブの機能は後続タスクで追加します。発信設定タブは現在利用できます。"
            title={`${AI_SETTINGS_TABS.find(([value]) => value === tab)?.[1]}は準備中です`}
          />
        )}
      </div>
    </main>
  );
}

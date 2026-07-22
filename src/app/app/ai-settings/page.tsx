import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/app-shell/page-state";
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
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AiPurposeSettings } from "./ai-purpose-settings";
import { PersonaSettingsForm } from "./persona-settings-form";

export const metadata: Metadata = { title: `AI設定 | ${APP_NAME}` };

const TABS = [
  ["persona", "発信設定"],
  ["purposes", "AI用途"],
  ["learning", "学習ソース"],
  ["base-md", "ベースmd"],
  ["prompts", "プロンプト"],
] as const;

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
  const tab = TABS.some(([value]) => value === params.tab)
    ? params.tab ?? "persona"
    : "persona";
  const supabase = await createSupabaseServerClient();
  const profile = await supabase
    .from("profiles")
    .select("active_x_account_id, ai_purpose_config, plan")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();
  let account: AccountRow | null = null;
  if (profile.data?.active_x_account_id) {
    const result = await supabase
      .from("x_accounts")
      .select("id, handle, settings, base_md, base_md_version")
      .eq("id", profile.data.active_x_account_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle<AccountRow>();
    account = result.data;
  }

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
  let validUserProviders: AiKeyProvider[] = [];
  if (tab === "purposes" && plan !== "premium") {
    const keys = await listApiKeyViewsForUser(user.id);
    validUserProviders = keys
      .filter(
        (key): key is typeof key & { provider: AiKeyProvider } =>
          key.provider !== "x" && key.status === "valid",
      )
      .map((key) => key.provider);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8 lg:py-10">
      <header>
        <p className="text-sm font-medium text-muted-foreground">SC-10</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">AI設定</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          発信の軸と、生成に使うAI・学習内容を管理します。
        </p>
      </header>

      <nav aria-label="AI設定タブ" className="mt-7 flex gap-1 overflow-x-auto border-b">
        {TABS.map(([value, label]) => (
          <Link
            aria-current={tab === value ? "page" : undefined}
            className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${
              tab === value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            href={`/app/ai-settings?tab=${value}`}
            key={value}
          >
            {label}
          </Link>
        ))}
      </nav>

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
        ) : (
          <EmptyState
            description="このタブの機能は後続タスクで追加します。発信設定タブは現在利用できます。"
            title={`${TABS.find(([value]) => value === tab)?.[1]}は準備中です`}
          />
        )}
      </div>
    </main>
  );
}

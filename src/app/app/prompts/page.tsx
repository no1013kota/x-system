import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyState, LockedState } from "@/components/app-shell/page-state";
import { AppLockedPage } from "@/components/app-shell/plan-required";
import { TabNav } from "@/components/app-shell/tab-nav";
import { Card, pageTitleClassName } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { loadRequestProfile } from "@/lib/profile/request-profile-server";
import { appLockFor } from "@/lib/auth/subscription-access";
import {
  BLANK_BASE_MD_TEMPLATE,
  DEFAULT_TONE_SETTINGS,
  baseMdSettingsDiffer,
  personaSettingsSchema,
  type PersonaSettings,
} from "@/lib/persona-settings";
import { isLearningRunningForUser } from "@/lib/base-md-server";
import { listPatternsForUser } from "@/lib/post/post-patterns-server";
import type { PatternOption, PatternPromptView } from "@/lib/post/post-patterns-store";
import { SYSTEM_DEFAULT_TEMPLATES, type PromptTemplateKind } from "@/lib/prompts/gen-prompts";
import type { PromptPresetView } from "@/lib/prompts/prompt-presets";
import { listPromptPresetsForUser } from "@/lib/prompts/prompt-presets-server";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";
import { PromptPresetManager } from "@/components/prompt/prompt-preset-manager";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readSingleRow } from "@/lib/supabase/single-row";

import { PatternManager } from "../settings/pattern-manager";
import { PersonaSettingsForm } from "../settings/persona-settings-form";
import { PROMPT_SECTIONS, normalizePromptSection } from "../settings/tabs";

/**
 * プロンプト管理（T-M8-328・運営者の指示 2026-08-27）。
 *
 * **設定のタブから独立した画面へ移した。** ここは「AIへ渡す指示をまとめて育てる場所」で、
 * 設定（連携・課金・通知）とは使う頻度も目的も違う。ナビの一項目にして、
 * アカウント.md・投稿の型・画像生成の3つを横並びで扱えるようにする。
 *
 * **3区分とも同じ形で扱う**（T-M8-332）。アカウント.mdと画像生成プロンプトも複数持てて、
 * 「使用中」の1件が生成に使われる（`PromptPresetManager`）。投稿作成プロンプトは
 * `PatternManager` が担うが、一覧・追加・保存の並びは共通部品
 * （`components/prompt/prompt-list-parts.tsx`）で揃えてある——**区分を移るたびに
 * 操作を探し直させない**。
 */
export const metadata: Metadata = { title: `プロンプト | ${APP_NAME}` };

interface AccountRow {
  base_md: string;
  base_md_version: number;
  handle: string;
  id: string;
  settings: unknown;
  /** 参考ソースから作った保存前の提案（T-M8-349）。無ければ null。 */
  settings_proposal: unknown;
}

const EMPTY_SETTINGS: PersonaSettings = {
  ng: { rules: [], topics: [], words: [] },
  persona: { audience: "", speaker: "", value: "" },
  themes: { free_text: "", primary: [], secondary: [] },
  tone: { ...DEFAULT_TONE_SETTINGS },
  volume: { free_text: "" },
};

interface PromptsPageProps {
  searchParams: Promise<{ sec?: string }>;
}

export default async function PromptsPage({ searchParams }: PromptsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/prompts");

  const params = await searchParams;
  const section = normalizePromptSection(params.sec);

  /*
    **profiles は1リクエストにつき1回だけ読む**（T-M8-286→T-M8-355）。以前はここで
    PostgREST経由の別クエリを投げていた——App Shell が既に読んでいる同じ行なので、
    往復が1つ丸ごと無駄だった（`active_x_account_id` を共有の1行へ足して解消）。
  */
  const admin = createSupabaseAdminClient();
  const profile = await loadRequestProfile(user.id);
  if (!profile) redirect("/app");
  const plan = profile.plan;
  const lock = appLockFor(profile.subscription_status);
  if (lock) {
    return (
      <AppLockedPage
        description="AIへ渡す指示（アカウント.md・投稿の型・画像生成）をまとめて編集できます。"
        reason={lock}
        title="プロンプト"
      />
    );
  }

  const accountResult = profile.active_x_account_id
    ? await admin
        .from("x_accounts")
        .select("id, handle, base_md, base_md_version, settings, settings_proposal")
        .eq("id", profile.active_x_account_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle<AccountRow>()
    : null;
  // 取得失敗を「未選択」にしない（T-M8-158）。nullへ潰すと、連携済みの利用者へ
  // 「Xアカウントを選択してください」が出て行き止まりになる。
  const account: AccountRow | null = accountResult
    ? readSingleRow(accountResult, "prompts x_account")
    : null;

  const editable = promptEditablePlan(plan ?? "");

  /*
    アカウント.mdの入力項目（5項目フォーム・T-M8-396で設定タブから移設）。
    保存済み設定・保存前の提案（参考アカウントの反映・T-M8-349）を読み、
    提案が変わったらフォームを作り直す（proposalKey・T-M8-356/357の教訓）。
  */
  const parsedSettings = account ? personaSettingsSchema.safeParse(account.settings) : null;
  const initialSettings = parsedSettings?.success ? parsedSettings.data : EMPTY_SETTINGS;
  const parsedProposal =
    account && account.settings_proposal
      ? personaSettingsSchema.safeParse(account.settings_proposal)
      : null;
  const settingsProposal = parsedProposal?.success ? parsedProposal.data : null;
  const proposalKey = settingsProposal
    ? `p${[...JSON.stringify(settingsProposal)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1_000_000_007, 7)}`
    : "saved";
  let initialDifference = false;
  if (account && account.base_md_version >= 1 && parsedSettings?.success) {
    try {
      initialDifference = baseMdSettingsDiffer(account.base_md, parsedSettings.data);
    } catch {
      initialDifference = true;
    }
  }

  let baseMdLearningRunning = false;
  /** 本棚（複数持てるプロンプト・T-M8-332）。区分ごとに読む。 */
  let presets: PromptPresetView[] = [];
  let patterns: PatternOption[] = [];
  let patternPrompts: Record<string, PatternPromptView> = {};
  let systemDefaultPrompts: Record<string, string> = {};

  if (account && editable) {
    if (section === "account-md") {
      /*
        **設定が未保存でも読む**（T-M8-350・運営者の指示 2026-08-28）。
        アカウント.mdは自由入力で何本でも作れるようにしたので、
        「アカウント設定を保存するまで1本も作れない」形にはできない。
      */
      [presets, baseMdLearningRunning] = await Promise.all([
        listPromptPresetsForUser({ userId: user.id, xAccountId: account.id, kind: "base_md" }),
        isLearningRunningForUser(user.id, account.id),
      ]);
    } else if (section === "image-prompt") {
      presets = await listPromptPresetsForUser({
        userId: user.id,
        xAccountId: account.id,
        kind: "image",
      });
    } else if (section === "post-prompt") {
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

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6">
      <h1 className={pageTitleClassName}>プロンプト</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        AIへ渡す指示をここでまとめて育てます。変更は次の生成から反映されます。
      </p>

      <div className="mt-5 space-y-4">
        <TabNav
          active={section}
          hrefFor={(slug) => `/app/prompts?sec=${slug}`}
          items={PROMPT_SECTIONS.map(([value, label]) => ({ value, label }))}
          label="プロンプトの区分"
        />

        {!editable ? (
          <LockedState
            actionHref="/plans"
            actionLabel="プランを見る"
            description="プロンプトの編集は、ご契約のプランでは利用できません。"
            title="プロンプトの編集はプラン変更で使えます"
          />
        ) : !account ? (
          <EmptyState
            actionHref="/app/settings"
            actionLabel="Xアカウントを連携する"
            description="編集にはXアカウントの連携が必要です。"
            title="先にXアカウントを連携してください"
          />
        ) : (
          <Card className="p-4 sm:p-5">
            {section === "account-md" ? (
              <div className="space-y-6">
                {baseMdLearningRunning ? (
                  <Notice tone="warn">
                    学習の反映処理中です。完了するまでアカウント.mdは保存できません。
                  </Notice>
                ) : null}
                {/*
                  **5項目の入力欄はここに置く**（T-M8-396・運営者の指示 2026-09-01。
                  設定＞アカウント設定は参考アカウント専用にした）。
                  参考アカウントの反映（settings_proposal）が届いたらフォームを作り直す。
                */}
                <PersonaSettingsForm
                  baseMdVersion={account.base_md_version}
                  initialDifference={initialDifference}
                  initialSettings={initialSettings}
                  key={`form:${account.id}:${proposalKey}`}
                  proposal={settingsProposal}
                  xAccountId={account.id}
                />
                <div className="border-t border-hairline pt-6">
                <PromptPresetManager
                  bodyLabel="アカウント.mdの本文"
                  emptyContentTemplate={account.base_md || BLANK_BASE_MD_TEMPLATE}
                  initialPresets={presets}
                  // アカウント切替でstateを捨てる（切替後も前アカウントの本文を保存できた・T-M8-196）。
                  key={`${section}:${account.id}`}
                  kind="base_md"
                  lead="AIが「誰として書くか」を決める文章です。使用中の1つが生成に使われます。上の入力項目を保存すると、使用中のアカウント.mdへ反映されます。"
                  xAccountId={account.id}
                />
                </div>
              </div>
            ) : section === "image-prompt" ? (
              <PromptPresetManager
                bodyLabel="画像プロンプトの本文"
                emptyContentTemplate={SYSTEM_DEFAULT_TEMPLATES.image}
                initialPresets={presets}
                key={`${section}:${account.id}`}
                kind="image"
                lead="画像を作るときにAIへ渡す指示です。使用中の1つが生成に使われます。"
                xAccountId={account.id}
              />
            ) : (
              <PatternManager
                initialPatterns={patterns}
                initialPrompts={patternPrompts}
                key={`${section}:${account.id}`}
                systemDefaultPrompts={systemDefaultPrompts}
                xAccountId={account.id}
              />
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

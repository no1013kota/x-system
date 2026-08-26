import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyState, LockedState } from "@/components/app-shell/page-state";
import { AppLockedPage } from "@/components/app-shell/plan-required";
import { TabNav } from "@/components/app-shell/tab-nav";
import { Card, pageTitleClassName } from "@/components/ui/card";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { appLockFor } from "@/lib/auth/subscription-access";
import type { BaseMdVersionView } from "@/lib/base-md";
import { isLearningRunningForUser, listBaseMdVersionsForUser } from "@/lib/base-md-server";
import { listPatternsForUser } from "@/lib/post/post-patterns-server";
import type { PatternOption, PatternPromptView } from "@/lib/post/post-patterns-store";
import { SYSTEM_DEFAULT_TEMPLATES, type PromptTemplateKind } from "@/lib/prompts/gen-prompts";
import { promptEditablePlan, type PromptTemplateView } from "@/lib/prompts/prompt-templates";
import { listPromptTemplatesForUser } from "@/lib/prompts/prompt-templates-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readSingleRow } from "@/lib/supabase/single-row";

import { BaseMdEditor } from "../settings/base-md-editor";
import { PatternManager } from "../settings/pattern-manager";
import { PromptTemplatesEditor } from "../settings/prompt-templates-editor";
import { PROMPT_SECTIONS, normalizePromptSection } from "../settings/tabs";

/**
 * プロンプト管理（T-M8-328・運営者の指示 2026-08-27）。
 *
 * **設定のタブから独立した画面へ移した。** ここは「AIへ渡す指示をまとめて育てる場所」で、
 * 設定（連携・課金・通知）とは使う頻度も目的も違う。ナビの一項目にして、
 * アカウント.md・投稿の型・画像生成の3つを横並びで扱えるようにする。
 *
 * データ取得と描画は設定ページから移設したもの。編集部品（`BaseMdEditor` /
 * `PatternManager` / `PromptTemplatesEditor`）は `../settings/` のものをそのまま使う——
 * **中身は同じなので複製しない**（複製すると片方だけ直る）。
 */
export const metadata: Metadata = { title: `プロンプト | ${APP_NAME}` };

interface AccountRow {
  base_md: string;
  base_md_version: number;
  handle: string;
  id: string;
}

interface PromptsPageProps {
  searchParams: Promise<{ sec?: string }>;
}

export default async function PromptsPage({ searchParams }: PromptsPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/prompts");

  const params = await searchParams;
  const section = normalizePromptSection(params.sec);

  /*
    `loadRequestProfile` は `active_x_account_id` を持たない（App Shell用の1行・T-M8-286）。
    ここは選択中アカウントが要るので profiles を直接読む（設定ページと同じ形）。
  */
  const admin = createSupabaseAdminClient();
  const profileResult = await admin
    .from("profiles")
    .select("active_x_account_id, plan, subscription_status")
    .eq("id", user.id)
    .maybeSingle<{
      active_x_account_id: string | null;
      plan: string | null;
      subscription_status: string;
    }>();
  const profile = readSingleRow(profileResult, "prompts profile");
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
        .select("id, handle, base_md, base_md_version")
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

  let baseMdHistory: BaseMdVersionView[] = [];
  let baseMdLearningRunning = false;
  let promptTemplates: PromptTemplateView[] = [];
  let patterns: PatternOption[] = [];
  let patternPrompts: Record<string, PatternPromptView> = {};
  let systemDefaultPrompts: Record<string, string> = {};

  if (account && editable) {
    if (section === "account-md" && account.base_md_version >= 1) {
      [baseMdHistory, baseMdLearningRunning] = await Promise.all([
        listBaseMdVersionsForUser(user.id, account.id),
        isLearningRunningForUser(user.id, account.id),
      ]);
    } else if (section === "image-prompt") {
      const res = await listPromptTemplatesForUser(user.id);
      promptTemplates = res.templates.filter((tpl) => tpl.kind === "image");
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
        ) : account.base_md_version < 1 ? (
          <EmptyState
            actionHref="/app/settings?tab=account"
            actionLabel="アカウント設定へ"
            description="編集対象のアカウント.mdを、先にアカウント設定から保存してください。"
            title="先にアカウント設定を保存してください"
          />
        ) : (
          <Card className="p-4 sm:p-5">
            {section === "account-md" ? (
              <BaseMdEditor
                initialContent={account.base_md}
                initialHistory={baseMdHistory}
                initialVersion={account.base_md_version}
                // アカウント切替でstateを捨てる（切替後も前アカウントの本文を保存できた・T-M8-196）。
                key={account.id}
                learningRunning={baseMdLearningRunning}
                xAccountId={account.id}
              />
            ) : section === "image-prompt" ? (
              <PromptTemplatesEditor
                initialTemplates={promptTemplates}
                key={`${section}:${account.id}`}
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

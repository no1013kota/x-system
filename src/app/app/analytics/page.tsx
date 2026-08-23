import type { Metadata } from "next";
import { isOperatorManagedPlan, type PlanId } from "@/lib/plans";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/app-shell/page-state";
import {
  loadAnalyticsForUser,
  loadFollowerSnapshotsForUser,
  loadSuggestionsForUser,
} from "@/lib/analytics-server";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { pooledQueryable } from "@/lib/db/pool";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { AnalyticsView } from "./analytics-view";
import { FollowerChart } from "./follower-chart";
import { SuggestionsPanel } from "./suggestions-panel";
import { pageTitleClassName } from "@/components/ui/card";

export const metadata: Metadata = { title: `投稿分析 | ${APP_NAME}` };

/** 実績表示は直近90日の投稿を対象にする（30日checkpointの回収期間＋余裕）。 */
const ANALYTICS_PERIOD_DAYS = 90;

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/analytics");

  const xAccountId = await resolveActiveXAccountForUser(user.id);
  if (!xAccountId) {
    return (
      <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
        <header>
            <h1 className={pageTitleClassName}>投稿分析</h1>
        </header>
        <div className="mt-7">
          <EmptyState
            actionHref="/app/settings?tab=x-accounts"
            actionLabel="Xアカウント設定へ"
            description="実績は連携済みのXアカウントごとに表示されます。"
            title="Xアカウントを選択してください"
          />
        </div>
      </main>
    );
  }

  const [drafts, followers, suggestionsSection, account, profile] = await Promise.all([
    loadAnalyticsForUser(user.id, xAccountId, ANALYTICS_PERIOD_DAYS),
    loadFollowerSnapshotsForUser(user.id, xAccountId, ANALYTICS_PERIOD_DAYS),
    loadSuggestionsForUser(user.id, xAccountId),
    pooledQueryable().query<{ handle: string }>(`select handle from x_accounts where id = $1`, [
      xAccountId,
    ]),
    // 提案のプロンプト全文は、編集権限（canEditMdAndPrompts）の有無で出し分ける（T-M8-91/T-M8-168）。
    // AIキーの有無は、BYOKで分析を開始できない理由（未登録）を画面から説明するために読む（T-M8-95）。
    pooledQueryable().query<{ plan: PlanId | null; has_ai_key: boolean }>(
      `select p.plan,
              exists (
                select 1 from user_api_keys k
                 where k.user_id = p.id and k.status = 'valid' and k.provider <> 'x'
              ) as has_ai_key
         from profiles p where p.id = $1`,
      [user.id],
    ),
  ]);
  // X上のポストへリンクするため handle を渡す（未取得でも i/status で開ける）。
  const handle = account.rows[0]?.handle ?? null;


  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
      <header>
        <h1 className={pageTitleClassName}>投稿分析</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          「分析を開始」を押すと、Xの投稿を取得・分析してレポートを作ります（1日1回）。フォロワー数は毎日自動で記録されます。
        </p>
      </header>
      {/* 並びは 分析レポート → 投稿ごとの実績 → フォロワー推移（運営者の指示・2026-08-15。
          レポートがこの画面の主目的で、フォロワー推移は補助情報のため最後）。 */}
      <div className="mt-7 space-y-8">
        <SuggestionsPanel
          generating={suggestionsSection.generating}
          needsAiKey={
            !isOperatorManagedPlan(profile.rows[0]?.plan ?? null) && !profile.rows[0]?.has_ai_key
          }
          canEditPrompts={promptEditablePlan(profile.rows[0]?.plan ?? "")}
          suggestions={suggestionsSection.suggestions}
        />
        <AnalyticsView drafts={drafts} handle={handle} />
        <FollowerChart points={followers} />
      </div>
    </main>
  );
}

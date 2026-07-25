import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/app-shell/page-state";
import {
  loadAnalyticsForUser,
  loadFollowerSnapshotsForUser,
  loadSuggestionsForUser,
} from "@/lib/analytics-server";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { AnalyticsView } from "./analytics-view";
import { FollowerChart } from "./follower-chart";
import { SuggestionsPanel } from "./suggestions-panel";

export const metadata: Metadata = { title: `分析 | ${APP_NAME}` };

/** 実績表示は直近90日の投稿を対象にする（30日checkpointの回収期間＋余裕）。 */
const ANALYTICS_PERIOD_DAYS = 90;

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/analytics");

  const xAccountId = await resolveActiveXAccountForUser(user.id);
  if (!xAccountId) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8 lg:py-10">
        <header>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">分析</h1>
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

  const [drafts, followers, suggestionsSection] = await Promise.all([
    loadAnalyticsForUser(user.id, xAccountId, ANALYTICS_PERIOD_DAYS),
    loadFollowerSnapshotsForUser(user.id, xAccountId, ANALYTICS_PERIOD_DAYS),
    loadSuggestionsForUser(user.id, xAccountId),
  ]);

  // 比較対象（監査・取得不能でなく、いずれかのcheckpointを取得済み）の投稿数。実績不足表示に使う。
  const comparablePostCount = drafts.reduce(
    (n, d) =>
      n +
      d.tweets.filter(
        (t) => !t.auditOnly && !t.unavailable && (t.checkpoints["1"] || t.checkpoints["7"] || t.checkpoints["30"]),
      ).length,
    0,
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8 lg:py-10">
      <header>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">分析</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          投稿の反応は、投稿後1日・7日・30日の3回だけ記録します。ここでは直近90日の投稿を新しい順に表示します。
        </p>
      </header>
      <div className="mt-7 space-y-8">
        <FollowerChart points={followers} />
        <AnalyticsView drafts={drafts} />
        <SuggestionsPanel
          comparablePostCount={comparablePostCount}
          generating={suggestionsSection.generating}
          suggestions={suggestionsSection.suggestions}
        />
      </div>
    </main>
  );
}

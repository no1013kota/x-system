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
import { pooledQueryable } from "@/lib/db/pool";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { AnalyticsView } from "./analytics-view";
import { FollowerChart } from "./follower-chart";
import { SuggestionsPanel } from "./suggestions-panel";

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
            <h1 className="text-[20px] font-bold tracking-tight text-ink">投稿分析</h1>
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
    // 提案のプロンプト全文は貼り先（AI設定＞プロンプト）が mdプラン以上のため、プランで出し分ける（T-M8-91）。
    pooledQueryable().query<{ plan: "standard" | "md" | "premium" }>(
      `select plan from profiles where id = $1`,
      [user.id],
    ),
  ]);
  // X上のポストへリンクするため handle を渡す（未取得でも i/status で開ける）。
  const handle = account.rows[0]?.handle ?? null;


  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
      <header>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">投稿分析</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          毎朝8時ごろに、Xへ投稿したポストを自動で取得・分析してレポートを作ります。下の実績表は、このアプリから投稿したポストを投稿後1日・7日・30日の3回記録したものです。
        </p>
      </header>
      {/* 並びは 分析レポート → 投稿ごとの実績 → フォロワー推移（運営者の指示・2026-08-15。
          レポートがこの画面の主目的で、フォロワー推移は補助情報のため最後）。 */}
      <div className="mt-7 space-y-8">
        <SuggestionsPanel
          generating={suggestionsSection.generating}
          plan={profile.rows[0]?.plan ?? "standard"}
          suggestions={suggestionsSection.suggestions}
        />
        <AnalyticsView drafts={drafts} handle={handle} />
        <FollowerChart points={followers} />
      </div>
    </main>
  );
}

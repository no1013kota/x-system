import type { Metadata } from "next";

import { SetupGuideCard } from "@/components/app-shell/setup-guide-card";
import type { AnalyticsSummary } from "@/lib/analytics";
import {
  getAnalyticsSummaryForUser,
  loadFollowerSnapshotsForUser,
} from "@/lib/analytics-server";
import { APP_NAME } from "@/lib/app-config";
import { formatJst } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth/session";
import { pooledQueryable } from "@/lib/db/pool";
import { listDraftsForAccount, type DraftView } from "@/lib/drafts";
import {
  buildSetupChecklist,
  type SetupChecklistItem,
} from "@/lib/execution-prereqs";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { DEFAULT_NEWS_CONFIG } from "@/lib/config-defaults";
import { scheduleOutlook, type ScheduleOutlook } from "@/lib/home/overview";
import {
  followerKpi,
  pendingDraftsKpi,
  postsThisWeekKpi,
  type HomeKpis,
} from "@/lib/home/kpi";
import { loadPostsThisWeek } from "@/lib/home/kpi-server";
import { nextRunKpi } from "@/lib/home/next-run-kpi";
import { KpiCard, NextRunCard } from "@/components/app-shell/kpi-card";
import type { NewsItemView } from "@/lib/news-items";
import { listNewsItemsForUser } from "@/lib/news-items-server";
import { getSettingsForUser } from "@/lib/settings-server";
import { loadRecentPosts, type RecentPostView } from "@/lib/home/overview-server";
import { listScheduleSlots } from "@/lib/schedule-slots";
import { UsageSummaryCard } from "@/components/app-shell/usage-summary-card";
import { formatNextMonthStartJst, type UsageSummary } from "@/lib/usage/usage-summary";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { ConfirmationQueueCard } from "./confirmation-queue";
import { ImportantNewsCard } from "./important-news";
import { RecentResultsCard } from "./recent-results";
import { UpcomingScheduleCard } from "./upcoming-schedule";

/** 直近の実績カードの集計期間（日）。SC-09の期間切替とは独立の固定値。 */
const RECENT_PERIOD_DAYS = 7;
/** 重要ニュースカードの表示件数。ホームは要約なので少数に絞る。 */
const IMPORTANT_NEWS_LIMIT = 3;

const pooledDb = pooledQueryable();

export const metadata: Metadata = {
  title: `ホーム | ${APP_NAME}`,
};

export default async function AppHomePage() {
  const user = await getCurrentUser();
  let checklist: SetupChecklistItem[] = [];
  let pendingDrafts: DraftView[] = [];
  let usage: UsageSummary | null = null;
  let outlook: ScheduleOutlook | null = null;
  let recentPosts: RecentPostView[] = [];
  let recentSummary: AnalyticsSummary | null = null;
  let handle: string | null = null;
  let importantNews: NewsItemView[] = [];
  let newsLoadFailed = false;
  let kpis: HomeKpis | null = null;
  if (user) {
    // 充足判定は実行前提検証ヘルパを再利用する（要件06 §3.1・T-M2-24）。
    const input = await gatherExecutionPrereqInputs(user.id);
    if (input) checklist = buildSetupChecklist(input);
    // 確認待ちキュー: active_x_account の未投稿下書き（status=draft）を新しい順に表示（要件06 §1）。
    const activeXAccountId = await resolveActiveXAccountForUser(user.id);
    if (activeXAccountId) {
      const all = await listDraftsForAccount(pooledDb, activeXAccountId, "drafts");
      pendingDrafts = all.filter((d) => d.status === "draft");
      // 次回の予定と直近の実績（要件06 §1・§10, T-M7-03）。
      const [slots, posts, summary, account] = await Promise.all([
        listScheduleSlots(pooledDb, activeXAccountId),
        loadRecentPosts(user.id, activeXAccountId),
        getAnalyticsSummaryForUser(user.id, activeXAccountId, RECENT_PERIOD_DAYS),
        pooledDb.query<{ handle: string }>(`select handle from x_accounts where id = $1`, [
          activeXAccountId,
        ]),
      ]);
      outlook = scheduleOutlook(slots);
      recentPosts = posts;
      recentSummary = summary;
      handle = account.rows[0]?.handle ?? null;
      // ホームのKPI（T-M8-05）。フォロワーは直近7日のsnapshotから増減を出す。
      const [followerPoints, weekPosts] = await Promise.all([
        loadFollowerSnapshotsForUser(user.id, activeXAccountId, 7),
        loadPostsThisWeek(user.id, activeXAccountId),
      ]);
      kpis = {
        followers: followerKpi(followerPoints),
        postsThisWeek: postsThisWeekKpi(weekPosts),
        pendingDrafts: pendingDraftsKpi(pendingDrafts.length),
        nextRun: nextRunKpi(outlook),
      };
    }
    // 重要ニュース: 利用者のニュース設定の分野で impact=high のみ（要件06 §1.4）。
    const settings = await getSettingsForUser(user.id);
    const categories = settings?.newsConfig?.categories ?? [...DEFAULT_NEWS_CONFIG.categories];
    try {
      const page = await listNewsItemsForUser({
        categories,
        impacts: ["high"],
        limit: IMPORTANT_NEWS_LIMIT,
      });
      importantNews = page.items;
    } catch {
      newsLoadFailed = true;
    }
    // premium 月間利用枠の残量（要件03 §8・要件06 §10, T-M6-12）。premium以外は null（非表示）。
    const { rows } = await pooledDb.query<{ plan: string }>(
      `select plan::text as plan from profiles where id = $1`,
      [user.id],
    );
    usage = await loadUsageSummaryForUser(user.id, rows[0]?.plan ?? "standard");
  }
  const nextSetupItem = checklist.find((item) => !item.satisfied);
  // 日付と次回実行を1行で添える（デザイン §画面一覧 1.ホーム）。
  const greeting = [
    formatJst(new Date().toISOString()).replace(/\s\d{1,2}:\d{2}$/, ""),
    kpis?.nextRun.label
      ? `次回の自動実行は ${kpis.nextRun.label} に予定されています`
      : "自動実行の予定はありません",
  ].join("・");

  return (
    // コンテナは新デザイン（max-width 1180px・padding 26px 32px・T-M8-05）。
    <main className="mx-auto w-full max-w-[1180px] space-y-3.5 px-4 py-[26px] lg:px-8">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">ホーム</h1>
        <p className="mt-1 text-[12.5px] text-ink-2">{greeting}</p>
      </div>

      {/* KPI 4カード。実データに繋ぐ（記録が無いときは0ではなく「記録なし」と出す）。 */}
      {kpis ? (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard kpi={kpis.followers} label="フォロワー数" />
          <KpiCard kpi={kpis.postsThisWeek} label="今週の投稿" />
          <KpiCard kpi={kpis.pendingDrafts} label="未確認の下書き" />
          <NextRunCard label={kpis.nextRun.label} note={kpis.nextRun.note} />
        </div>
      ) : null}

      {nextSetupItem ? <SetupGuideCard items={checklist} /> : null}
      <ConfirmationQueueCard drafts={pendingDrafts} />
      {outlook ? (
        <UpcomingScheduleCard
          outlook={outlook}
          setupPendingHref={nextSetupItem?.settingsPath}
        />
      ) : null}
      <ImportantNewsCard items={importantNews} loadFailed={newsLoadFailed} />
      {recentSummary ? (
        <RecentResultsCard handle={handle} posts={recentPosts} summary={recentSummary} />
      ) : null}
      {usage ? (
        <UsageSummaryCard nextResetLabel={formatNextMonthStartJst(new Date())} summary={usage} />
      ) : null}
    </main>
  );
}

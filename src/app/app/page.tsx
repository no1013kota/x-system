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
import { listPendingDraftsForHome, type DraftView } from "@/lib/drafts";
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
/** 確認待ちキューの表示上限。超過分は総数と「すべて見る」で辿れる（T-M8-67）。 */
const PENDING_QUEUE_LIMIT = 5;

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
  let pendingTotal = 0;
  if (user) {
    /**
     * user.id にしか依存しない取得を第1波、activeXAccountId等が要るものを第2波に
     * まとめる（T-M8-67）。以前は約9段の直列awaitで、Supabaseへの往復（本番で
     * 1回あたり数十〜百ms）がそのまま初回表示の待ち時間に積み上がっていた。
     */
    const [input, activeXAccountId, settings, planRows] = await Promise.all([
      // 充足判定は実行前提検証ヘルパを再利用する（要件06 §3.1・T-M2-24）。
      gatherExecutionPrereqInputs(user.id),
      resolveActiveXAccountForUser(user.id),
      getSettingsForUser(user.id),
      pooledDb.query<{ plan: string }>(
        `select plan::text as plan from profiles where id = $1`,
        [user.id],
      ),
    ]);
    if (input) checklist = buildSetupChecklist(input);
    // 重要ニュース: 利用者のニュース設定の分野で impact=high のみ（要件06 §1.4）。
    const categories = settings?.newsConfig?.categories ?? [...DEFAULT_NEWS_CONFIG.categories];
    const newsPromise = listNewsItemsForUser({
      categories,
      impacts: ["high"],
      limit: IMPORTANT_NEWS_LIMIT,
    }).then(
      (page) => ({ failed: false, items: page.items }),
      // 失敗による空をUIで区別する（原則1）。ImportantNewsCard が理由を表示する。
      () => ({ failed: true, items: [] as NewsItemView[] }),
    );
    // premium 月間利用枠の残量（要件03 §8・要件06 §10, T-M6-12）。premium以外は null（非表示）。
    const usagePromise = loadUsageSummaryForUser(
      user.id,
      planRows.rows[0]?.plan ?? "standard",
    );
    if (activeXAccountId) {
      // 確認待ちキュー（status=draftを新しい順・要件06 §1）・次回の予定・直近の実績・KPI。
      const [pending, slots, posts, summary, account, followerPoints, weekPosts, news, usageSummary] =
        await Promise.all([
          listPendingDraftsForHome(pooledDb, activeXAccountId, PENDING_QUEUE_LIMIT),
          listScheduleSlots(pooledDb, activeXAccountId),
          loadRecentPosts(user.id, activeXAccountId),
          getAnalyticsSummaryForUser(user.id, activeXAccountId, RECENT_PERIOD_DAYS),
          pooledDb.query<{ handle: string }>(`select handle from x_accounts where id = $1`, [
            activeXAccountId,
          ]),
          loadFollowerSnapshotsForUser(user.id, activeXAccountId, 7),
          loadPostsThisWeek(user.id, activeXAccountId),
          newsPromise,
          usagePromise,
        ]);
      pendingDrafts = pending.drafts;
      pendingTotal = pending.total;
      outlook = scheduleOutlook(slots);
      recentPosts = posts;
      recentSummary = summary;
      handle = account.rows[0]?.handle ?? null;
      importantNews = news.items;
      newsLoadFailed = news.failed;
      usage = usageSummary;
      // ホームのKPI（T-M8-05）。フォロワーは直近7日のsnapshotから増減を出す。
      kpis = {
        followers: followerKpi(followerPoints),
        postsThisWeek: postsThisWeekKpi(weekPosts),
        pendingDrafts: pendingDraftsKpi(pending.total),
        nextRun: nextRunKpi(outlook),
      };
    } else {
      const [news, usageSummary] = await Promise.all([newsPromise, usagePromise]);
      importantNews = news.items;
      newsLoadFailed = news.failed;
      usage = usageSummary;
    }
  }
  const nextSetupItem = checklist.find((item) => !item.satisfied);
  // 日付のみ（T-M8-66: 次回実行の文はKPIカード「次回の自動実行」と同じ情報の重複だった）。
  const greeting = formatJst(new Date().toISOString()).replace(/\s\d{1,2}:\d{2}$/, "");

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
      <ConfirmationQueueCard drafts={pendingDrafts} total={pendingTotal} />
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

import type { Metadata } from "next";

import { SetupGuideCard } from "@/components/app-shell/setup-guide-card";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import { getPool } from "@/lib/db/pool";
import { listDraftsForAccount, type DraftView } from "@/lib/drafts";
import {
  buildSetupChecklist,
  type SetupChecklistItem,
} from "@/lib/execution-prereqs";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { UsageSummaryCard } from "@/components/app-shell/usage-summary-card";
import { formatNextMonthStartJst, type UsageSummary } from "@/lib/usage/usage-summary";
import { loadUsageSummaryForUser } from "@/lib/usage/usage-summary-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";
import type { Queryable } from "@/lib/x/token-refresh";

import { ConfirmationQueueCard } from "./confirmation-queue";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

export const metadata: Metadata = {
  title: `ホーム | ${APP_NAME}`,
};

export default async function AppHomePage() {
  const user = await getCurrentUser();
  let checklist: SetupChecklistItem[] = [];
  let pendingDrafts: DraftView[] = [];
  let usage: UsageSummary | null = null;
  if (user) {
    // 充足判定は実行前提検証ヘルパを再利用する（要件06 §3.1・T-M2-24）。
    const input = await gatherExecutionPrereqInputs(user.id);
    if (input) checklist = buildSetupChecklist(input);
    // 確認待ちキュー: active_x_account の未投稿下書き（status=draft）を新しい順に表示（要件06 §1）。
    const activeXAccountId = await resolveActiveXAccountForUser(user.id);
    if (activeXAccountId) {
      const all = await listDraftsForAccount(pooledDb, activeXAccountId, "drafts");
      pendingDrafts = all.filter((d) => d.status === "draft");
    }
    // premium 月間利用枠の残量（要件03 §8・要件06 §10, T-M6-12）。premium以外は null（非表示）。
    const { rows } = await pooledDb.query<{ plan: string }>(
      `select plan::text as plan from profiles where id = $1`,
      [user.id],
    );
    usage = await loadUsageSummaryForUser(user.id, rows[0]?.plan ?? "standard");
  }
  const showGuide = checklist.some((item) => !item.satisfied);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 lg:px-8 lg:py-10">
      <h1 className="text-2xl font-bold tracking-tight">ホーム</h1>
      {showGuide ? <SetupGuideCard items={checklist} /> : null}
      <ConfirmationQueueCard drafts={pendingDrafts} />
      {usage ? (
        <UsageSummaryCard nextResetLabel={formatNextMonthStartJst(new Date())} summary={usage} />
      ) : null}
    </main>
  );
}

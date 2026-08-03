import type { Metadata } from "next";

import { TabNav } from "@/components/app-shell/tab-nav";
import { XAccountRequiredNotice } from "@/components/x-account-required-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getPool, pooledQueryable } from "@/lib/db/pool";
import { listDraftsForAccount, type DraftView } from "@/lib/drafts";
import { listScheduleSlots, type ScheduleSlotView } from "@/lib/schedule-slots";
import { ScheduleSummary } from "./schedule-summary";
import { env } from "@/lib/env";
import { attachSignedImageUrls } from "@/lib/images/signed-url-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

const pooledDb = pooledQueryable();

import { POST_PATTERN_OPTIONS, QUOTE_PATTERN_OPTION } from "@/lib/post/post-patterns";

import { CreatePostForm, type ActiveJob } from "./create-post-form";
import { DraftsList } from "./drafts-list";
import { HistoryList } from "./history-list";

export const metadata: Metadata = { title: "投稿 | Space AI" };

type Tab = "create" | "drafts" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "create", label: "作成" },
  { id: "drafts", label: "下書き" },
  { id: "history", label: "履歴" },
];

interface PostsPageProps {
  searchParams: Promise<{ tab?: string; draftId?: string }>;
}

/** BYOKは valid な openai/google キー、premiumは運営キー＋画像モデルが設定済みのproviderを返す。 */
async function availableImageProviders(
  userId: string,
  plan: string | null,
): Promise<string[]> {
  if (plan === "premium") {
    const providers: string[] = [];
    if (env.OPENAI_API_KEY && env.OPENAI_IMAGE_MODEL) providers.push("openai");
    if (env.GEMINI_API_KEY && env.GEMINI_IMAGE_MODEL) providers.push("google");
    return providers;
  }
  const { rows } = await getPool().query<{ provider: string }>(
    `select provider from user_api_keys
      where user_id = $1 and provider in ('openai','google') and status = 'valid'`,
    [userId],
  );
  return rows.map((r) => r.provider);
}

async function createTabData(userId: string, activeXAccountId: string) {
  const profile = (
    await getPool().query<{ plan: string | null }>(`select plan from profiles where id = $1`, [
      userId,
    ])
  ).rows[0];
  // 選択肢は `lib/post/post-patterns.ts` が唯一の定義（スケジュール画面と共有・T-M8-29）。
  const patterns = env.FEATURE_QUOTE_POST_ENABLED
    ? [...POST_PATTERN_OPTIONS, QUOTE_PATTERN_OPTION]
    : POST_PATTERN_OPTIONS;
  const imageProviders = await availableImageProviders(userId, profile?.plan ?? null);
  const inflight = (
    await getPool().query<{
      id: string;
      status: string;
      progress_stage: string | null;
      created_at: Date | string;
    }>(
      `select id, status, progress_stage, created_at from generation_jobs
        where x_account_id = $1 and kind = 'post_generation' and status in ('queued','running')
        order by created_at desc limit 1`,
      [activeXAccountId],
    )
  ).rows[0];
  const initialJob: ActiveJob | null = inflight
    ? {
        id: inflight.id,
        status: inflight.status,
        progressStage: inflight.progress_stage,
        draftId: null,
        createdAt: new Date(inflight.created_at).toISOString(),
        error: null,
      }
    : null;
  return { patterns, imageProviders, initialJob };
}

export default async function PostsPage({ searchParams }: PostsPageProps) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">
        <p className="text-sm text-muted-foreground">ログインが必要です。</p>
      </main>
    );
  }
  const tab: Tab = TABS.some((t) => t.id === params.tab) ? (params.tab as Tab) : "create";
  const activeXAccountId = await resolveActiveXAccountForUser(user.id);

  let drafts: DraftView[] = [];
  let imageRegenEnabled = false;
  let xHandle: string | null = null;
  // デザインは「下書き・スケジュール」が1画面（T-M8-10）。URLは変えず、下書きタブでは
  // スケジュールの概要も併せて出す。編集はスケジュール画面で行う。
  let slots: ScheduleSlotView[] = [];
  if (activeXAccountId && (tab === "drafts" || tab === "history")) {
    const [loaded, plan] = await Promise.all([
      listDraftsForAccount(pooledDb, activeXAccountId, tab === "history" ? "history" : "drafts"),
      getPool()
        .query<{ plan: string | null }>(`select plan from profiles where id = $1`, [user.id])
        .then((r) => r.rows[0]?.plan ?? null),
    ]);
    drafts = await attachSignedImageUrls(loaded);
    if (tab === "drafts") {
      // BYOKでopenai/googleがともに未登録なら再生成providerが無いので非活性にする（PRD §8.2）。
      imageRegenEnabled = (await availableImageProviders(user.id, plan)).length > 0;
    } else {
      xHandle = (
        await getPool().query<{ handle: string }>(`select handle from x_accounts where id = $1`, [
          activeXAccountId,
        ])
      ).rows[0]?.handle ?? null;
    }
  }
  if (activeXAccountId && tab === "drafts") {
    slots = await listScheduleSlots(pooledDb, activeXAccountId);
  }
  const createData =
    activeXAccountId && tab === "create" ? await createTabData(user.id, activeXAccountId) : null;

  return (
    <main className="mx-auto w-full max-w-[1180px] space-y-3.5 px-4 py-[26px] lg:px-8">
      <header>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">投稿作成</h1>
        <p className="text-sm text-muted-foreground">
          パターンを選んで投稿を生成し、下書きで確認・編集して投稿します。
        </p>
      </header>

      <TabNav
        active={tab}
        hrefFor={(id) => `/app/posts?tab=${id}`}
        items={TABS.map((t) => ({ value: t.id, label: t.label }))}
        label="投稿タブ"
      />

      {!activeXAccountId ? (
        <XAccountRequiredNotice description="投稿を生成するには、まずXアカウントを連携してください。" />
      ) : tab === "create" && createData ? (
        <CreatePostForm
          imageProviders={createData.imageProviders}
          initialJob={createData.initialJob}
          patterns={createData.patterns}
          xAccountId={activeXAccountId}
        />
      ) : tab === "drafts" ? (
        <>
          <ScheduleSummary slots={slots} />
          <DraftsList
            drafts={drafts}
            imageRegenEnabled={imageRegenEnabled}
            quotePostEnabled={env.FEATURE_QUOTE_POST_ENABLED}
            selectedDraftId={params.draftId}
          />
        </>
      ) : (
        <HistoryList drafts={drafts} handle={xHandle} selectedDraftId={params.draftId} />
      )}
    </main>
  );
}

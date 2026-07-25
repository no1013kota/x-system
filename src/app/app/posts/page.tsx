import type { Metadata } from "next";

import { TabNav } from "@/components/app-shell/tab-nav";
import { XAccountRequiredNotice } from "@/components/x-account-required-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { getPool, pooledQueryable } from "@/lib/db/pool";
import { listDraftsForAccount, type DraftView } from "@/lib/drafts";
import { env } from "@/lib/env";
import { attachSignedImageUrls } from "@/lib/images/signed-url-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

const pooledDb = pooledQueryable();

import {
  CreatePostForm,
  type ActiveJob,
  type PatternOption,
} from "./create-post-form";
import { DraftsList } from "./drafts-list";
import { HistoryList } from "./history-list";

export const metadata: Metadata = { title: "投稿 | Space AI" };

type Tab = "create" | "drafts" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "create", label: "作成" },
  { id: "drafts", label: "下書き" },
  { id: "history", label: "履歴" },
];

const ALL_PATTERNS: PatternOption[] = [
  { id: "p1", label: "ニュース解説", description: "話題のニュースを解説するスレッド" },
  { id: "p2", label: "自分の考え・意見", description: "本人の視点で述べる単発ポスト" },
  { id: "p3", label: "ノウハウ・ハウツー", description: "今日から実践できる手順スレッド" },
  { id: "p4", label: "トレンド便乗", description: "いま話題のトピックに便乗" },
  { id: "p6", label: "週次まとめ", description: "直近7日の関連ニュースまとめ" },
  // P-5（引用ポスト）は FEATURE_QUOTE_POST_ENABLED=true のときだけ追加する。
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
  const patterns = env.FEATURE_QUOTE_POST_ENABLED
    ? [
        ...ALL_PATTERNS,
        { id: "p5", label: "引用ポスト", description: "対象ポストへの引用（URL付き投稿）" },
      ]
    : ALL_PATTERNS;
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
  const createData =
    activeXAccountId && tab === "create" ? await createTabData(user.id, activeXAccountId) : null;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 lg:px-8 lg:py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">投稿</h1>
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
        <DraftsList
          drafts={drafts}
          imageRegenEnabled={imageRegenEnabled}
          quotePostEnabled={env.FEATURE_QUOTE_POST_ENABLED}
          selectedDraftId={params.draftId}
        />
      ) : (
        <HistoryList drafts={drafts} handle={xHandle} selectedDraftId={params.draftId} />
      )}
    </main>
  );
}

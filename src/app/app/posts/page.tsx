import type { Metadata } from "next";
import Link from "next/link";

import { TabNav } from "@/components/app-shell/tab-nav";
import { Notice } from "@/components/ui/notice";
import { XAccountRequiredNotice } from "@/components/x-account-required-notice";
import { getCurrentUser } from "@/lib/auth/session";
import { serverNowMs } from "@/lib/time/server-now";
import { getPool, pooledQueryable } from "@/lib/db/pool";
import { listDraftsForAccount, type DraftView } from "@/lib/drafts";
import { locateDraft, type DraftLocation } from "@/lib/drafts/locate-draft";
import { listScheduleSlots, type ScheduleSlotView } from "@/lib/schedule-slots";
import { ScheduleSummary } from "./schedule-summary";
import { env } from "@/lib/env";
import { imageProvidersFor } from "@/lib/ai/image-providers-server";
import { attachSignedImageUrls } from "@/lib/images/signed-url-server";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

const pooledDb = pooledQueryable();

import { listPatterns, listPatternPrompts } from "@/lib/post/post-patterns-store";
import { listPromptTemplatesForUser } from "@/lib/prompts/prompt-templates-server";

import { CreatePostForm, type ActiveJob } from "./create-post-form";
import { DraftsList } from "./drafts-list";
import { HistoryList } from "./history-list";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";
import { pageTitleClassName } from "@/components/ui/card";

export const metadata: Metadata = { title: "投稿 | Exos AI" };

type Tab = "create" | "drafts" | "history";

/**
 * 履歴タブの取得上限（T-M8-67）。自動投稿を続けると履歴は際限なく増え、全件取得だと
 * thread/imagesのJSON転送と画像の署名URL発行（1枚1HTTP）が件数分走る。
 * 上限に達したときは「直近N件」と画面に明示する（黙って切り捨てない）。
 */
const HISTORY_LIMIT = 50;
const TABS: { id: Tab; label: string }[] = [
  { id: "create", label: "作成" },
  { id: "drafts", label: "下書き" },
  { id: "history", label: "履歴" },
];

interface PostsPageProps {
  searchParams: Promise<{ tab?: string; draftId?: string }>;
}

/** valid な openai/google キーの行（plan判定前に並列で引けるよう、クエリと判定を分離・T-M8-67）。 */
function imageKeyRowsQuery(userId: string) {
  return getPool().query<{ provider: string }>(
    `select provider from user_api_keys
      where user_id = $1 and provider in ('openai','google') and status = 'valid'`,
    [userId],
  );
}

async function createTabData(userId: string, activeXAccountId: string) {
  // 3クエリは相互に独立（T-M8-67。以前は plan → キー → 実行中job の3段直列だった）。
  const [profileResult, keyRows, inflightResult, allPatterns] = await Promise.all([
    getPool().query<{ plan: string | null }>(`select plan from profiles where id = $1`, [
      userId,
    ]),
    imageKeyRowsQuery(userId),
    getPool().query<{
      id: string;
      status: string;
      progress_stage: string | null;
      created_at: Date | string;
    }>(
      `select id, status, progress_stage, created_at from generation_jobs
        where x_account_id = $1 and kind = 'post_generation' and status in ('queued','running')
        order by created_at desc limit 1`,
      [activeXAccountId],
    ),
    // 選択肢は `post_patterns`（アカウント別マスタ）から引く。**自作パターンもここに出る**（U3）。
    listPatterns(pooledDb, activeXAccountId),
  ]);
  // 引用ポストは feature flag が OFF の間は選ばせない（要件05 §5）。
  const patterns = env.FEATURE_QUOTE_POST_ENABLED
    ? allPatterns
    : allPatterns.filter((option) => !option.requiresQuoteUrl);
  const plan = profileResult.rows[0]?.plan ?? null;
  const imageProviders = imageProvidersFor(plan, keyRows.rows);
  // 生成に使うプロンプトの表示・編集（T-M8-92）。プロンプトのカスタマイズは編集権限のあるプラン（T-M8-168で全プラン）
  // （AI設定＞プロンプトと同じ境界）なので、standard には渡さない＝セクションごと出さない。
  // updatedAt は「保存して以後も使う」の楽観ロック（AI設定と同じ仕組み）に使う。
  let promptTemplates: Record<string, { content: string; updatedAt: string | null; isOverride: boolean }> | null =
    null;
  let baseMd: { content: string; version: number } | null = null;
  // 判定は `promptEditablePlan` に集約（T-M8-144）。
  if (promptEditablePlan(plan ?? "")) {
    const [patternPrompts, listed, baseMdRow] = await Promise.all([
      // パターンのプロンプトは `post_patterns.prompt`（U2/U3）。画像だけ `prompt_templates`。
      listPatternPrompts(pooledDb, activeXAccountId),
      listPromptTemplatesForUser(userId),
      getPool().query<{ base_md: string; base_md_version: number }>(
        `select base_md, base_md_version from x_accounts where id = $1`,
        [activeXAccountId],
      ),
    ]);
    // キーはパターンID（uuid）と `image`。**内部ID（`p1`）では引かない**（T-M8-129 U3）。
    const image = listed.templates.find((tpl) => tpl.kind === "image");
    promptTemplates = {
      ...Object.fromEntries(
        patterns
          .filter((option) => patternPrompts[option.id])
          .map((option) => [option.id, patternPrompts[option.id]]),
      ),
      ...(image
        ? {
            image: {
              content: image.content,
              updatedAt: image.updatedAt,
              isOverride: image.isOverride,
            },
          }
        : {}),
    };
    const row = baseMdRow.rows[0];
    baseMd = row ? { content: row.base_md ?? "", version: Number(row.base_md_version ?? 0) } : null;
  }
  const inflight = inflightResult.rows[0];
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
  // 経過表示の基準（T-M8-113）。サーバーとブラウザで同じ値を使わないと
  // 「経過 0:06」と「経過 0:07」が食い違って描き直しになる。
  return { patterns, imageProviders, initialJob, nowMs: await serverNowMs(), promptTemplates, baseMd };
}

/**
 * 通知から来たのに対象の下書きが無いときの案内（T-M8-115）。
 *
 * **黙って通常の一覧を出さない。** 通知を押した利用者は特定の下書きを見に来ているので、
 * 「なぜ無いのか」と「どこへ行けばあるのか」を出す。案内不要なら何も描かない。
 */
function MissingDraftNotice({
  location,
  tab,
}: {
  location: DraftLocation | null;
  tab: "drafts" | "history";
}) {
  if (!location) return null;
  if (location.kind === "other-tab" && location.tab !== tab) {
    const label = location.tab === "history" ? "履歴" : "下書き";
    return (
      <Notice tone="info">
        お探しの投稿は<strong>{label}</strong>に移っています。
        <Link className="ml-1 underline" href={`/app/posts?tab=${location.tab}`}>
          {label}を開く
        </Link>
      </Notice>
    );
  }
  if (location.kind === "gone") {
    return (
      <Notice tone="info">
        お探しの投稿は見つかりませんでした。破棄されたか、別のXアカウントのものです。
      </Notice>
    );
  }
  return null;
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
  let historyTruncated = false;
  /** 通知から来たが対象が見つからなかったときの案内（null＝案内不要）。 */
  let missingDraft: DraftLocation | null = null;
  if (activeXAccountId && (tab === "drafts" || tab === "history")) {
    // 相互に独立な取得を1波にまとめる（T-M8-67。以前は drafts → 署名URL → provider → slots の直列4段）。
    const [loaded, plan, keyRows, loadedSlots, handleRow] = await Promise.all([
      listDraftsForAccount(
        pooledDb,
        activeXAccountId,
        tab === "history" ? "history" : "drafts",
        tab === "history" ? { limit: HISTORY_LIMIT } : {},
      ),
      getPool()
        .query<{ plan: string | null }>(`select plan from profiles where id = $1`, [user.id])
        .then((r) => r.rows[0]?.plan ?? null),
      tab === "drafts" ? imageKeyRowsQuery(user.id) : Promise.resolve(null),
      tab === "drafts" ? listScheduleSlots(pooledDb, activeXAccountId) : Promise.resolve([]),
      tab === "history"
        ? getPool().query<{ handle: string }>(`select handle from x_accounts where id = $1`, [
            activeXAccountId,
          ])
        : Promise.resolve(null),
    ]);
    drafts = await attachSignedImageUrls(loaded);
    slots = loadedSlots;
    historyTruncated = tab === "history" && loaded.length === HISTORY_LIMIT;
    /**
     * 通知が指す下書きが、このタブに見当たらないとき（T-M8-115）。
     *
     * 通知を押すのは数時間〜数日あと。そのあいだに下書きは投稿されて履歴へ移るか、
     * 破棄されて消えている。以前は**ただの一覧が出るだけで説明が無く**、
     * 「押しても何も起きなかった」ように見えていた。どこへ行ったのかを画面で言う。
     */
    if (params.draftId && !drafts.some((d) => d.id === params.draftId)) {
      missingDraft = await locateDraft(pooledDb, activeXAccountId, params.draftId);
    }
    if (tab === "drafts") {
      // BYOKでopenai/googleがともに未登録なら再生成providerが無いので非活性にする（PRD §8.2）。
      imageRegenEnabled = imageProvidersFor(plan, keyRows?.rows ?? []).length > 0;
    } else {
      xHandle = handleRow?.rows[0]?.handle ?? null;
    }
  }
  const createData =
    activeXAccountId && tab === "create" ? await createTabData(user.id, activeXAccountId) : null;

  return (
    <main className="mx-auto w-full max-w-[1180px] space-y-3.5 px-4 py-[26px] lg:px-8">
      {/* 見出し下の流れ説明は置かない。タブとフォームから読み取れる（T-M8-66）。 */}
      <header>
        <h1 className={pageTitleClassName}>投稿作成</h1>
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
          initialNowMs={createData.nowMs}
          patterns={createData.patterns}
          baseMd={createData.baseMd}
          promptTemplates={createData.promptTemplates}
          xAccountId={activeXAccountId}
        />
      ) : tab === "drafts" ? (
        <>
          <MissingDraftNotice location={missingDraft} tab="drafts" />
          <ScheduleSummary slots={slots} />
          <DraftsList
            drafts={drafts}
            imageRegenEnabled={imageRegenEnabled}
            quotePostEnabled={env.FEATURE_QUOTE_POST_ENABLED}
            selectedDraftId={params.draftId}
          />
        </>
      ) : (
        <>
          <MissingDraftNotice location={missingDraft} tab="history" />
          <HistoryList drafts={drafts} handle={xHandle} selectedDraftId={params.draftId} />
          {historyTruncated ? (
            <p className="text-caption text-ink-3">直近{HISTORY_LIMIT}件を表示しています。</p>
          ) : null}
        </>
      )}
    </main>
  );
}

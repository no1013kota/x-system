import { z } from "zod";

import { POST_THEME_IDS } from "@/lib/post/post-theme";
import { requirePattern } from "@/lib/post/post-patterns-store";

import {
  assertPrereqsFromInput,
  checkPostingPrerequisites,
  type ExecutionPrereqInput,
} from "@/lib/execution-prereqs";
import { assertDraftSchedulable } from "@/lib/draft-schedule";
import { AppError } from "@/lib/observability/errors";
import { assertAutomationConsent } from "@/lib/x/automation-consent";

import { validateManualBaseMd } from "../base-md";
import { hasRemovingLearningSource } from "@/lib/learning-sources";

import type { Queryable } from "../x/token-refresh";
import { assertActiveAccount, assertJobBudget, MAX_ACTIVE_JOBS } from "./job-guards";
import { requestKey } from "./keys";

// 既存の import 名を保つための re-export（正本は `job-guards.ts`・R20）。
export { MAX_ACTIVE_JOBS };

/**
 * 生成jobの Server Action 中核（要件05 §5/§12/§2.2, 要件04 §3, T-M3-07）。
 * zod検証・前提再検証・所有権/active一致・request_key冪等・queued/running 5件制限を満たして
 * post_generation を作成し、失敗系はコード＋不足項目/設定パス入りの AppError を投げる。
 * DB・前提収集・feature flag は注入する（`after()`でのdispatchはAction層）。
 */


export const createGenerationJobSchema = z.object({
  request_key: z.string().min(1).max(200),
  x_account_id: z.string().uuid(),
  /** 使うパターン（`post_patterns.id`）。**内部IDでは受けない**（T-M8-129 U5）。 */
  pattern_id: z.string().uuid(),
  source_url: z
    .string()
    // `.url()` は refine より先に issue を作るので、こちらにも同じ文言を持たせる（F10）。
    .url("httpsのURLを指定してください。")
    .refine((u) => u.startsWith("https://"), "httpsのURLを指定してください。")
    .nullish(),
  quote_url: z.string().url().nullish(),
  /** パターンの入力項目（`{名前}` へ差し込む値）。キーは項目名（T-M8-132）。 */
  placeholder_values: z.record(z.string(), z.string().max(2000)).nullish(),
  instructions: z.string().max(2000).nullish(),
  /**
   * 分野。**必須**（T-M8-29）。「その他」は追加指示へ分野を書く意思表示で、
   * プロンプトへは分野を出さない（`lib/post/post-theme.ts`）。
   */
  theme: z.enum(POST_THEME_IDS),
  image_enabled: z.boolean().optional().default(false),
  /**
   * 生成したあとどうするか（T-M8-331・運営者の指示 2026-08-27）。
   * - `draft`: 下書きに置く（既定・従来の挙動）
   * - `now`: 生成が終わり次第 `post_publish` へ連鎖する（スケジュールの mode=auto と同じ経路）
   * - `scheduled`: 下書きへ `scheduled_at` を入れる。到来したら `scheduled-drafts` の cron が拾う
   *
   * `now`／`scheduled` は**利用者が本文を見ないまま投稿される**ので、自動投稿の同意が要る。
   */
  post_mode: z.enum(["draft", "now", "scheduled"]).optional().default("draft"),
  /**
   * `post_mode = "scheduled"` の予約日時。`datetime-local` の素の値（TZ無し）は
   * **日本時間として**解釈する——判定と変換は `@/lib/draft-schedule` の純粋層に任せる
   * （ここで独自に変換すると本番のUTCサーバで9時間ずれる・T-M8-229）。
   */
  scheduled_at: z.string().min(1).max(40).nullish(),
  news_item_id: z.string().uuid().nullish(),
  /**
   * この生成にだけ使うプロンプト（T-M8-92/93・md/premium）。
   * null/未指定なら通常の解決（アカウント上書き→system default→コード定数）。
   * 上限はAI設定＞プロンプトの保存上限と同じ（片方だけ長い値を許すと「保存する」を選んだときに落ちる）。
   */
  prompt_override: z
    .string()
    .max(8000, "プロンプトは8,000字以内で入力してください。")
    .nullish(),
  /** この生成にだけ使うアカウント.md（T-M8-93）。上限はAI設定＞アカウント.mdの保存上限と同じ。見出し構造は中核で検証する。 */
  base_md_override: z
    .string()
    .max(5000, "アカウント.mdは5,000字以内で入力してください。")
    .nullish(),
  /** この生成にだけ使う画像プロンプト（T-M8-93）。画像OFFのときは無視される。 */
  image_prompt_override: z
    .string()
    .max(8000, "画像プロンプトは8,000字以内で入力してください。")
    .nullish(),
});

export type CreateGenerationJobInput = z.infer<typeof createGenerationJobSchema>;

export const jobIdSchema = z.object({ job_id: z.string().uuid() });
export const retryJobSchema = z.object({
  request_key: z.string().min(1).max(200),
  job_id: z.string().uuid(),
});

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export interface GenerationJobDeps {
  runInTx: RunInTx;
  gatherPrereqInputs: (
    userId: string,
    opts: { imageRequested: boolean },
  ) => Promise<ExecutionPrereqInput | null>;
  quotePostEnabled: boolean;
}

export interface CreateJobResult {
  jobId: string;
  /** 冪等ヒット（既存jobを返した）。true のとき Action は再dispatchしない。 */
  deduped: boolean;
}

function buildInputJson(
  input: CreateGenerationJobInput,
  /** 受理済みの予約日時（UTCのISO）。`post_mode` が `scheduled` 以外なら null。 */
  scheduledAtIso: string | null,
): Record<string, unknown> {
  const postMode = input.post_mode ?? "draft";
  return {
    source_url: input.source_url ?? null,
    quote_url: input.quote_url ?? null,
    quote_tweet_id: null,
    placeholder_values: input.placeholder_values ?? null,
    instructions: input.instructions ?? null,
    theme: input.theme,
    image_enabled: input.image_enabled,
    news_item_id: input.news_item_id ?? null,
    // この生成にだけ使うプロンプト・アカウント.md・画像プロンプト（T-M8-92/93）。
    // 空文字は「指定なし」と同義なので null に落とす。
    prompt_override: input.prompt_override?.trim() ? input.prompt_override : null,
    base_md_override: input.base_md_override?.trim() ? input.base_md_override : null,
    image_prompt_override: input.image_prompt_override?.trim() ? input.image_prompt_override : null,
    /*
      **投稿まで進むかを job に持たせる**（T-M8-331）。生成worker（`post-generation.ts`）は
      `job.input.mode` しか見ないので、スケジュールと同じキー名で渡す。
      `scheduled` を `auto` にはしない——投稿へ連鎖させると**予約時刻より前に出てしまう**。
      予約は下書きの `scheduled_at` に入れ、到来したら cron（`scheduled-drafts`）が拾う。
    */
    mode: postMode === "now" ? "auto" : "draft",
    requested_mode: postMode === "now" ? "auto" : "draft",
    scheduled_at: scheduledAtIso,
  };
}

async function assertPrereqs(
  deps: GenerationJobDeps,
  userId: string,
  imageRequested: boolean,
): Promise<void> {
  assertPrereqsFromInput(await deps.gatherPrereqInputs(userId, { imageRequested }));
}

async function assertPostingPrereqs(deps: GenerationJobDeps, userId: string): Promise<void> {
  assertPrereqsFromInput(
    await deps.gatherPrereqInputs(userId, { imageRequested: false }),
    checkPostingPrerequisites,
  );
}

export async function createGenerationJob(
  userId: string,
  input: CreateGenerationJobInput,
  deps: GenerationJobDeps,
): Promise<CreateJobResult> {

  // この生成にだけ使うアカウント.mdも、保存版と同じ見出し検証を通す（T-M8-93）。
  // 通さないと、画像生成のセクション3抽出が黙って空になる等、静かな劣化になる。
  if (input.base_md_override?.trim()) {
    validateManualBaseMd(input.base_md_override);
  }
  /*
    **投稿まで進む指定は、生成を始める前に受理判定する**（T-M8-331・原則2）。
    日時の判定と JST→UTC 変換は下書き画面と同じ純粋層に通す——ここで独自に判定すると
    「画面では通るのに保存で弾かれる」「本番のUTCサーバで9時間ずれる」が起きる。
  */
  const postMode = input.post_mode ?? "draft";
  const scheduledAtIso =
    postMode === "scheduled"
      ? assertDraftSchedulable(
          { status: "draft", xAccountActive: true },
          input.scheduled_at ?? "",
          Date.now(),
        )
      : null;
  const key = requestKey(userId, input.request_key);
  return deps.runInTx(async (tx) => {
    const existing = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    if (existing) return { jobId: existing.id, deduped: true };

    await assertActiveAccount(tx, userId, input.x_account_id);
    // 学習ソース削除merge中は古い知見での生成を避けるため新規生成を止める（要件04 §12, T-M5-05）。
    if (await hasRemovingLearningSource(tx, input.x_account_id)) {
      throw new AppError("job_conflict", { details: { reason: "learning_removing" } });
    }
    await assertPrereqs(deps, userId, input.image_enabled);
    /*
      **投稿する指定なら、投稿の前提と自動投稿の同意もここで見る**（T-M8-331）。
      生成が終わってから投稿直前に弾くと、AIの費用を使ったあとで「投稿されない」ことに
      気付くことになる。同意ゲートはスケジュールと同じ関数を使う（判定を2箇所に置かない）。
    */
    if (postMode !== "draft") {
      await assertPostingPrereqs(deps, userId);
      await assertAutomationConsent(tx, input.x_account_id);
    }
    await assertJobBudget(tx, userId);

    // 所有者チェックを兼ねてパターンを取り、引用ポストの feature flag をここで見る

    // （外部呼び出し・枠消費の前に拒否する・要件05 §5）。

    const pattern = await requirePattern(tx, input.x_account_id, input.pattern_id);

    if (pattern.requiresQuoteUrl && !deps.quotePostEnabled) {

      throw new AppError("feature_disabled", { details: { feature: "quote_post" } });

    }

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, pattern_id, input, request_key, status)
         values ($1, 'post_generation', 'manual', $2, $3::jsonb, $4, 'queued')
         on conflict (request_key) do nothing
         returning id`,
        [input.x_account_id, pattern.id, JSON.stringify(buildInputJson(input, scheduledAtIso)), key],
      )
    ).rows[0];
    if (inserted) return { jobId: inserted.id, deduped: false };

    // 競合で別txが同一request_keyを挿入済み。
    const raced = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    return { jobId: raced.id, deduped: true };
  });
}

// 旧 createDraftFromNews（SC-06からの直接job作成）はT-M8-210で削除。
// 「すぐに投稿作成」は投稿作成画面への遷移＋{ニュース}自動入力になった。

export const regenerateDraftSchema = z.object({
  request_key: z.string().min(1).max(200),
  draft_id: z.string().uuid(),
  additional_instructions: z.string().max(2000).nullish(),
  image_enabled: z.boolean().optional().default(false),
});
export type RegenerateDraftInput = z.infer<typeof regenerateDraftSchema>;

/**
 * 元draftを保持し、parent_draft_id を持つ派生draftを生成する新jobを作る（要件05 §5, T-M3-13）。
 * status=draft または未解決投稿のない failed のみ。元draftの本文/pattern/出典を snapshot として
 * job.input へ保存し、worker が previous_draft を素材に追加指示で作り直す。新しい top-level job。
 */
export async function regenerateDraft(
  userId: string,
  input: RegenerateDraftInput,
  deps: GenerationJobDeps,
): Promise<CreateJobResult> {
  const key = requestKey(userId, input.request_key);
  return deps.runInTx(async (tx) => {
    const existing = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    if (existing) return { jobId: existing.id, deduped: true };

    const draft = (
      await tx.query<{
        status: string;
        pattern_id: string | null;
          requires_quote_url: boolean;
        thread: { text: string; sources?: string[] }[];
        x_account_id: string;
        tweet_ids: string[];
        last_post_error: unknown;
      }>(
        `select d.status, d.pattern_id, d.requires_quote_url, d.thread, d.x_account_id, d.tweet_ids, d.last_post_error
           from drafts d join x_accounts xa on xa.id = d.x_account_id
          where d.id = $1 and xa.user_id = $2`,
        [input.draft_id, userId],
      )
    ).rows[0];
    if (!draft) throw new AppError("not_found");
    if (draft.status !== "draft" && draft.status !== "failed") {
      throw new AppError("job_conflict", { details: { reason: `not_regenerable:${draft.status}` } });
    }
    if (
      draft.status === "failed" &&
      ((Array.isArray(draft.tweet_ids) && draft.tweet_ids.length > 0) ||
        draft.last_post_error != null)
    ) {
      throw new AppError("job_conflict", { details: { reason: "unresolved_posting" } });
    }
  // 判定は**生成時に写した値**（T-M8-129 U5。旧enumは撤去した）。
    if (draft.requires_quote_url && !deps.quotePostEnabled) {
      throw new AppError("feature_disabled", { details: { feature: "quote_post" } });
    }
    await assertPrereqs(deps, userId, input.image_enabled);
    await assertJobBudget(tx, userId);

    const previousPosts = Array.isArray(draft.thread)
      ? draft.thread.map((p) => p.text).filter((t): t is string => typeof t === "string")
      : [];
    const jobInput = {
      // 再生成は元の下書きと同じパターンで作る。
      pattern_id: draft.pattern_id,
      source_url: null,
      quote_url: null,
      quote_tweet_id: null,
      instructions: input.additional_instructions ?? null,
      image_enabled: input.image_enabled,
      news_item_id: null,
      requested_mode: "draft",
      parent_draft_id: input.draft_id,
      previous_posts: previousPosts,
    };

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, pattern_id, input, request_key, status)
         values ($1, 'post_generation', 'manual', $2, $3::jsonb, $4, 'queued')
         on conflict (request_key) do nothing
         returning id`,
        [draft.x_account_id, draft.pattern_id, JSON.stringify(jobInput), key],
      )
    ).rows[0];
    if (inserted) return { jobId: inserted.id, deduped: false };
    const raced = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    return { jobId: raced.id, deduped: true };
  });
}

export const regenerateImageSchema = z.object({
  request_key: z.string().min(1).max(200),
  draft_id: z.string().uuid(),
  /** 対象ポスト（T-M8-398）。未指定は1ポスト目（従来互換）。 */
  post_local_id: z.string().min(1).max(20).optional(),
});
export type RegenerateImageInput = z.infer<typeof regenerateImageSchema>;

/**
 * 添付画像の再生成（要件05 §5・要件06 §6・要件04 §9, T-M3-16）。draft所有・状態(draft/failed)を
 * 検証し、`image_generation` job を冪等に作る。冪等は request_key と「1draftにactiveな画像job1件」
 * （unique index）の二重で担保する。既存画像は保持し、workerが新画像の保存成功後に置換・旧object削除する。
 */
export async function regenerateImage(
  userId: string,
  input: RegenerateImageInput,
  deps: GenerationJobDeps,
): Promise<CreateJobResult> {
  const key = requestKey(userId, input.request_key);
  return deps.runInTx(async (tx) => {
    const existing = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    if (existing) return { jobId: existing.id, deduped: true };

    const draft = (
      await tx.query<{ status: string; pattern_id: string | null; requires_quote_url: boolean; x_account_id: string }>(
        `select d.status, d.pattern_id, d.requires_quote_url, d.x_account_id
           from drafts d join x_accounts xa on xa.id = d.x_account_id
          where d.id = $1 and xa.user_id = $2`,
        [input.draft_id, userId],
      )
    ).rows[0];
    if (!draft) throw new AppError("not_found");
  // 判定は**生成時に写した値**（T-M8-129 U5。旧enumは撤去した）。
    if (draft.requires_quote_url && !deps.quotePostEnabled) {
      throw new AppError("feature_disabled", { details: { feature: "quote_post" } });
    }
    if (draft.status !== "draft" && draft.status !== "failed") {
      throw new AppError("job_conflict", { details: { reason: `not_regenerable:${draft.status}` } });
    }

    // 既に画像jobがqueued/running中なら二重生成しない（unique index と対称の冪等）。
    const active = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs
          where draft_id = $1 and kind = 'image_generation' and status in ('queued', 'running')`,
        [input.draft_id],
      )
    ).rows[0];
    if (active) return { jobId: active.id, deduped: true };

    await assertPrereqs(deps, userId, true); // 画像キー必須
    await assertJobBudget(tx, userId);

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, draft_id, input, request_key, status)
         values ($1, 'image_generation', 'manual', $2, $3::jsonb, $4, 'queued')
         on conflict do nothing
         returning id`,
        [
          draft.x_account_id,
          input.draft_id,
          JSON.stringify({ regenerate: true, post_local_id: input.post_local_id }),
          key,
        ],
      )
    ).rows[0];
    if (inserted) return { jobId: inserted.id, deduped: false };

    // 競合（request_key もしくは active画像job unique）で挿入されず。既存を返す。
    const raced = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs
          where request_key = $1
             or (draft_id = $2 and kind = 'image_generation' and status in ('queued', 'running'))
          limit 1`,
        [key, input.draft_id],
      )
    ).rows[0];
    if (!raced) throw new AppError("job_conflict", { details: { reason: "image_job_race" } });
    return { jobId: raced.id, deduped: true };
  });
}

export const publishDraftSchema = z.object({
  request_key: z.string().min(1).max(200),
  draft_id: z.string().uuid(),
  mode: z.literal("manual").default("manual"),
});
export type PublishDraftInput = z.infer<typeof publishDraftSchema>;

interface PublishDraftRow {
  status: string;
  requires_quote_url: boolean;
  x_account_id: string;
  x_account_status: string;
  tweet_ids: string[];
  last_post_error: {
    remaining_tweet_ids?: string[];
    ambiguous_create_indices?: number[];
    ambiguous_delete_tweet_ids?: string[];
  } | null;
}

/** 未解決の投稿状態（作成履歴・残存ID・曖昧状態）があり直接再投稿できない failed か。 */
function hasUnresolvedPosting(draft: PublishDraftRow): boolean {
  const lpe = draft.last_post_error;
  return (
    (Array.isArray(draft.tweet_ids) && draft.tweet_ids.length > 0) ||
    (lpe?.remaining_tweet_ids?.length ?? 0) > 0 ||
    (lpe?.ambiguous_create_indices?.length ?? 0) > 0 ||
    (lpe?.ambiguous_delete_tweet_ids?.length ?? 0) > 0
  );
}

/**
 * 手動投稿（要件05 §5・要件06 §7, T-M3-21）。`status=draft`、または tweet_id作成履歴・残存ID・
 * 曖昧状態がすべて無い retryable `failed` のみ許可。activeな post_publish job（unique index）と
 * request_key で二重に冪等化して post_publish job を作る。前提は投稿用（契約→Xキー→X連携）。
 */
export async function publishDraft(
  userId: string,
  input: PublishDraftInput,
  deps: GenerationJobDeps,
): Promise<CreateJobResult> {
  const key = requestKey(userId, input.request_key);
  return deps.runInTx(async (tx) => {
    const existing = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    if (existing) return { jobId: existing.id, deduped: true };

    const draft = (
      await tx.query<PublishDraftRow>(
        `select d.status, d.pattern_id, d.requires_quote_url, d.x_account_id, xa.status::text as x_account_status,
                d.tweet_ids, d.last_post_error
           from drafts d join x_accounts xa on xa.id = d.x_account_id
          where d.id = $1 and xa.user_id = $2`,
        [input.draft_id, userId],
      )
    ).rows[0];
    if (!draft) throw new AppError("not_found");
    // プラン変更等で expired/disabled になったアカウントの下書きは投稿しない（要件06 §2・§9, T-M6-11）。
    // 再連携（設定→Xアカウント）まで投稿・自動実行は停止し、閲覧・編集のみ許可する。
    if (draft.x_account_status !== "active") {
      throw new AppError("x_account_required", {
        details: {
          missing: ["x_account"],
          settingsPath: "/app/settings?tab=x-accounts",
          reason: `x_account_${draft.x_account_status}`,
        },
      });
    }
  // 判定は**生成時に写した値**（T-M8-129 U5。旧enumは撤去した）。
    if (draft.requires_quote_url && !deps.quotePostEnabled) {
      throw new AppError("feature_disabled", { details: { feature: "quote_post" } });
    }
    if (draft.status === "draft") {
      // ok
    } else if (draft.status === "failed") {
      if (hasUnresolvedPosting(draft)) {
        // 作成履歴・残存・曖昧がある failed は複製(cloneFailedDraftForRetry)で再開する。直接再投稿しない。
        throw new AppError("job_conflict", { details: { reason: "unresolved_posting" } });
      }
    } else {
      throw new AppError("job_conflict", { details: { reason: `not_publishable:${draft.status}` } });
    }

    // 同一draftのactive post_publishが既にあれば二重投稿しない（unique index と対称）。
    const active = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs
          where draft_id = $1 and kind = 'post_publish' and status in ('queued', 'running')`,
        [input.draft_id],
      )
    ).rows[0];
    if (active) return { jobId: active.id, deduped: true };

    await assertPostingPrereqs(deps, userId);
    await assertJobBudget(tx, userId);

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, draft_id, input, request_key, status)
         values ($1, 'post_publish', 'manual', $2, $3::jsonb, $4, 'queued')
         on conflict do nothing
         returning id`,
        [draft.x_account_id, input.draft_id, JSON.stringify({ mode: input.mode }), key],
      )
    ).rows[0];
    if (inserted) return { jobId: inserted.id, deduped: false };

    const raced = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs
          where request_key = $1
             or (draft_id = $2 and kind = 'post_publish' and status in ('queued', 'running'))
          limit 1`,
        [key, input.draft_id],
      )
    ).rows[0];
    if (!raced) throw new AppError("job_conflict", { details: { reason: "post_publish_race" } });
    return { jobId: raced.id, deduped: true };
  });
}

export interface GenerationJobView {
  id: string;
  kind: string;
  status: string;
  pattern: string | null;
  progress_stage: string | null;
  draft_id: string | null;
  error: unknown;
  created_at: string;
}

export async function getGenerationJob(
  db: Queryable,
  userId: string,
  jobId: string,
): Promise<GenerationJobView> {
  const row = (
    await db.query<GenerationJobView>(
      // `provider_raw_error` は**ブラウザへ返さない**（F6）。要件06 §5「画面に出さない」と
      // 要件01 §8「ユーザー向けerrorへproviderの応答を出さない」を、描画側の注意ではなく
      // クエリで守る。運営者はDBと `npm run smoke:live` で中身を見る。
      `select gj.id, gj.kind, gj.status, gj.pattern_id, gj.progress_stage, gj.draft_id,
              (gj.error - 'provider_raw_error') as error, gj.created_at
         from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where gj.id = $1 and xa.user_id = $2`,
      [jobId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  return row;
}

export async function retryGenerationJob(
  userId: string,
  input: { job_id: string; request_key: string },
  deps: GenerationJobDeps,
): Promise<CreateJobResult> {
  const key = requestKey(userId, input.request_key);
  return deps.runInTx(async (tx) => {
    const existing = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    if (existing) return { jobId: existing.id, deduped: true };

    const job = (
      await tx.query<{
        status: string;
        kind: string;
        pattern_id: string | null;
          pattern_spec: unknown;
        input: unknown;
        x_account_id: string;
      }>(
        `select gj.status, gj.kind, gj.pattern_id, gj.pattern_spec, gj.input, gj.x_account_id
           from generation_jobs gj join x_accounts xa on xa.id = gj.x_account_id
          where gj.id = $1 and xa.user_id = $2`,
        [input.job_id, userId],
      )
    ).rows[0];
    if (!job) throw new AppError("not_found");
    if (job.status !== "failed") {
      throw new AppError("job_conflict", { details: { reason: "not_failed" } });
    }
    /*
      **再試行にも契約の前提を課す**（T-M8-267）。以前は所有・failed・同時実行数しか見ておらず、
      解約後に失敗ジョブを再試行するとAI生成やX読取が走った（`request_key` を変えれば何度でも）。
      作成系（`createGenerationJob` 等）と同じ入口ゲートを通す。実行時の最終防壁は `leaseJob`。
    */
    await assertPrereqs(deps, userId, false);
    await assertJobBudget(tx, userId);

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, pattern_id, pattern_spec, input, request_key, status, parent_job_id)
         values ($1, $2, 'manual', $3, $4::jsonb, $5::jsonb, $6, 'queued', $7)
         on conflict (request_key) do nothing
         returning id`,
        [
          job.x_account_id,
          job.kind,
          job.pattern_id,
          // **再試行は当時の spec をそのまま引き継ぐ**（間にパターンを編集されても結果が変わらない）。
          JSON.stringify(job.pattern_spec),
          JSON.stringify(job.input ?? {}),
          key,
          input.job_id,
        ],
      )
    ).rows[0];
    if (inserted) return { jobId: inserted.id, deduped: false };
    const raced = (
      await tx.query<{ id: string }>(
        `select id from generation_jobs where request_key = $1`,
        [key],
      )
    ).rows[0];
    return { jobId: raced.id, deduped: true };
  });
}

export async function cancelGenerationJob(
  db: Queryable,
  userId: string,
  jobId: string,
): Promise<{ status: string }> {
  const row = (
    await db.query<{ status: string }>(
      `select gj.status from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where gj.id = $1 and xa.user_id = $2`,
      [jobId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  if (row.status === "canceled") return { status: "canceled" }; // 冪等
  if (row.status !== "queued") {
    // running はキャンセル不可、終端（succeeded/failed）も不可（要件05 §5）。
    throw new AppError("job_conflict", { details: { reason: `not_cancelable:${row.status}` } });
  }
  await db.query(
    `update generation_jobs set status = 'canceled', finished_at = now() where id = $1 and status = 'queued'`,
    [jobId],
  );
  return { status: "canceled" };
}

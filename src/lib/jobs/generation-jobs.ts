import { z } from "zod";

import {
  checkExecutionPrerequisites,
  checkPostingPrerequisites,
  type ExecutionPrereqInput,
} from "@/lib/execution-prereqs";
import { AppError } from "@/lib/observability/errors";
import { hasRemovingLearningSource } from "@/lib/learning-sources";

import type { Queryable } from "../x/token-refresh";
import { requestKey } from "./keys";

/**
 * 生成jobの Server Action 中核（要件05 §5/§12/§2.2, 要件04 §3, T-M3-07）。
 * zod検証・前提再検証・所有権/active一致・request_key冪等・queued/running 5件制限を満たして
 * post_generation を作成し、失敗系はコード＋不足項目/設定パス入りの AppError を投げる。
 * DB・前提収集・feature flag は注入する（`after()`でのdispatchはAction層）。
 */

export const MAX_ACTIVE_JOBS = 5;

export const createGenerationJobSchema = z.object({
  request_key: z.string().min(1).max(200),
  x_account_id: z.string().uuid(),
  pattern: z.enum(["p1", "p2", "p3", "p4", "p5", "p6"]),
  source_url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "httpsのURLを指定してください")
    .nullish(),
  quote_url: z.string().url().nullish(),
  user_opinion: z.string().max(2000).nullish(),
  instructions: z.string().max(2000).nullish(),
  image_enabled: z.boolean().optional().default(false),
  image_provider: z.enum(["openai", "google"]).nullish(),
  news_item_id: z.string().uuid().nullish(),
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

function buildInputJson(input: CreateGenerationJobInput): Record<string, unknown> {
  return {
    pattern: input.pattern,
    source_url: input.source_url ?? null,
    quote_url: input.quote_url ?? null,
    quote_tweet_id: null,
    user_opinion: input.user_opinion ?? null,
    instructions: input.instructions ?? null,
    image_enabled: input.image_enabled,
    image_provider: input.image_provider ?? null,
    news_item_id: input.news_item_id ?? null,
    requested_mode: "draft",
  };
}

async function assertActiveAccount(
  tx: Queryable,
  userId: string,
  xAccountId: string,
): Promise<void> {
  const row = (
    await tx.query<{ status: string; active_x_account_id: string | null }>(
      `select xa.status, p.active_x_account_id
         from x_accounts xa join profiles p on p.id = xa.user_id
        where xa.id = $1 and xa.user_id = $2`,
      [xAccountId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  // 表示中アカウントと実行対象の不一致（別タブ・別端末での切替競合）を拒否（要件05 §4.1）。
  if (row.active_x_account_id !== xAccountId) {
    throw new AppError("job_conflict", { details: { reason: "x_account_mismatch" } });
  }
}

async function assertPrereqs(
  deps: GenerationJobDeps,
  userId: string,
  imageRequested: boolean,
): Promise<void> {
  const input = await deps.gatherPrereqInputs(userId, { imageRequested });
  const error = input
    ? checkExecutionPrerequisites(input)
    : { code: "not_found" as const, missing: [], settingsPath: "/app" };
  if (error) {
    throw new AppError(error.code, {
      details: { missing: error.missing, settingsPath: error.settingsPath },
    });
  }
}

async function assertPostingPrereqs(deps: GenerationJobDeps, userId: string): Promise<void> {
  const input = await deps.gatherPrereqInputs(userId, { imageRequested: false });
  const error = input
    ? checkPostingPrerequisites(input)
    : { code: "not_found" as const, missing: [], settingsPath: "/app" };
  if (error) {
    throw new AppError(error.code, {
      details: { missing: error.missing, settingsPath: error.settingsPath },
    });
  }
}

async function assertJobBudget(tx: Queryable, userId: string): Promise<void> {
  const active = (
    await tx.query<{ n: number }>(
      `select count(*)::int as n from generation_jobs gj
         join x_accounts xa on xa.id = gj.x_account_id
        where xa.user_id = $1 and gj.status in ('queued', 'running')`,
      [userId],
    )
  ).rows[0].n;
  if (active >= MAX_ACTIVE_JOBS) {
    throw new AppError("job_conflict", { details: { reason: "too_many_active_jobs" } });
  }
}

export async function createGenerationJob(
  userId: string,
  input: CreateGenerationJobInput,
  deps: GenerationJobDeps,
): Promise<CreateJobResult> {
  // P-5 は feature flag OFF の間、外部呼び出し・枠消費の前に拒否（要件05 §5）。
  if (input.pattern === "p5" && !deps.quotePostEnabled) {
    throw new AppError("feature_disabled", { details: { feature: "quote_post" } });
  }
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
    await assertJobBudget(tx, userId);

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, pattern, input, request_key, status)
         values ($1, 'post_generation', 'manual', $2, $3::jsonb, $4, 'queued')
         on conflict (request_key) do nothing
         returning id`,
        [input.x_account_id, input.pattern, JSON.stringify(buildInputJson(input)), key],
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

export const createDraftFromNewsSchema = z.object({
  request_key: z.string().min(1).max(200),
  x_account_id: z.string().uuid(),
  news_item_id: z.string().uuid(),
  instructions: z.string().max(2000).nullish(),
  image_enabled: z.boolean().optional(),
  image_provider: z.enum(["openai", "google"]).nullish(),
});

export type CreateDraftFromNewsInput = z.infer<typeof createDraftFromNewsSchema>;

/**
 * N-4: ニュース起点の下書き生成（要件05 §6, GEN-P1）。`news_item` の `source_url` を引き継いだ
 * P-1 の post_generation を冪等作成する。前提再検証・所有権/active一致・image_provider必須・
 * queued/running 5件制限・request_key 冪等は `createGenerationJob` に委譲する。作成後 worker が
 * `input.news_item_id` を `drafts.source_news_item_id` へ保存する（作成済みバッジの導出元）。
 */
export async function createDraftFromNews(
  userId: string,
  input: CreateDraftFromNewsInput,
  deps: GenerationJobDeps,
): Promise<CreateJobResult> {
  const source = await deps.runInTx((tx) =>
    tx.query<{ source_url: string }>(
      `select source_url from news_items where id = $1`,
      [input.news_item_id],
    ),
  );
  const sourceUrl = source.rows[0]?.source_url;
  if (!sourceUrl) throw new AppError("not_found");
  return createGenerationJob(
    userId,
    {
      request_key: input.request_key,
      x_account_id: input.x_account_id,
      pattern: "p1",
      source_url: sourceUrl,
      quote_url: null,
      user_opinion: null,
      instructions: input.instructions ?? null,
      image_enabled: input.image_enabled ?? false,
      image_provider: input.image_provider ?? null,
      news_item_id: input.news_item_id,
    },
    deps,
  );
}

export const regenerateDraftSchema = z.object({
  request_key: z.string().min(1).max(200),
  draft_id: z.string().uuid(),
  additional_instructions: z.string().max(2000).nullish(),
  image_enabled: z.boolean().optional().default(false),
  image_provider: z.enum(["openai", "google"]).nullish(),
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
        pattern: string;
        thread: { text: string; sources?: string[] }[];
        x_account_id: string;
        tweet_ids: string[];
        last_post_error: unknown;
      }>(
        `select d.status, d.pattern, d.thread, d.x_account_id, d.tweet_ids, d.last_post_error
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
    if (draft.pattern === "p5" && !deps.quotePostEnabled) {
      throw new AppError("feature_disabled", { details: { feature: "quote_post" } });
    }
    await assertPrereqs(deps, userId, input.image_enabled);
    await assertJobBudget(tx, userId);

    const previousPosts = Array.isArray(draft.thread)
      ? draft.thread.map((p) => p.text).filter((t): t is string => typeof t === "string")
      : [];
    const jobInput = {
      pattern: draft.pattern,
      source_url: null,
      quote_url: null,
      quote_tweet_id: null,
      user_opinion: null,
      instructions: input.additional_instructions ?? null,
      image_enabled: input.image_enabled,
      image_provider: input.image_provider ?? null,
      news_item_id: null,
      requested_mode: "draft",
      parent_draft_id: input.draft_id,
      previous_posts: previousPosts,
    };

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, pattern, input, request_key, status)
         values ($1, 'post_generation', 'manual', $2, $3::jsonb, $4, 'queued')
         on conflict (request_key) do nothing
         returning id`,
        [draft.x_account_id, draft.pattern, JSON.stringify(jobInput), key],
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
      await tx.query<{ status: string; pattern: string; x_account_id: string }>(
        `select d.status, d.pattern, d.x_account_id
           from drafts d join x_accounts xa on xa.id = d.x_account_id
          where d.id = $1 and xa.user_id = $2`,
        [input.draft_id, userId],
      )
    ).rows[0];
    if (!draft) throw new AppError("not_found");
    if (draft.pattern === "p5" && !deps.quotePostEnabled) {
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
        [draft.x_account_id, input.draft_id, JSON.stringify({ regenerate: true }), key],
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
  pattern: string;
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
        `select d.status, d.pattern, d.x_account_id, xa.status::text as x_account_status,
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
    if (draft.pattern === "p5" && !deps.quotePostEnabled) {
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
      `select gj.id, gj.kind, gj.status, gj.pattern, gj.progress_stage, gj.draft_id,
              gj.error, gj.created_at
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
        pattern: string | null;
        input: unknown;
        x_account_id: string;
      }>(
        `select gj.status, gj.kind, gj.pattern, gj.input, gj.x_account_id
           from generation_jobs gj join x_accounts xa on xa.id = gj.x_account_id
          where gj.id = $1 and xa.user_id = $2`,
        [input.job_id, userId],
      )
    ).rows[0];
    if (!job) throw new AppError("not_found");
    if (job.status !== "failed") {
      throw new AppError("job_conflict", { details: { reason: "not_failed" } });
    }
    await assertJobBudget(tx, userId);

    const inserted = (
      await tx.query<{ id: string }>(
        `insert into generation_jobs
           (x_account_id, kind, trigger, pattern, input, request_key, status, parent_job_id)
         values ($1, $2, 'manual', $3, $4::jsonb, $5, 'queued', $6)
         on conflict (request_key) do nothing
         returning id`,
        [
          job.x_account_id,
          job.kind,
          job.pattern,
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

import { checkExecutionPrerequisites, type ExecutionPrereqInput } from "@/lib/execution-prereqs";
import type { PromptTemplateKind } from "@/lib/prompts/gen-prompts";
import { resolvePromptTemplate } from "@/lib/prompts/prompt-templates";
import { themesToNewsCategories } from "@/lib/themes";

import {
  buildGenSystem,
  buildGenUser,
  fetchNewsDigest,
  fetchRecentPostBodies,
} from "../ai/gen-context";
import { genOutputSchema, postsToThread } from "../ai/gen-output";
import { InvalidProviderOutputError, runTextGeneration } from "../ai/pipeline";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { heartbeat } from "./stale";

/**
 * post_generation ジョブの中核（要件04 §8/§14, プロンプト設計書 §5.1/§7.1/§7.4, T-M3-05）。
 * 前提再検証→stage(validating→research→writing)→context組み立て→生成→JSON検証→draft作成→
 * usage保存→draft_created通知 のハッピーパス。DB・provider解決・前提収集は注入し、workerが実配線する。
 *
 * 失敗（前提不足・JSON検証不能・AIのerror返却）は error/usage/通知を（poolで）確定保存してから throw する。
 * runJob は throw で status='failed' にする（handler tx はロールバックされるため確定保存を別途行う）。
 * 生成枠 reserve/refund（要件03 §7）はM6、auto時の post_publish 子job作成はM4で追加する。
 */

const EMPTY_USAGE: GenerationUsage = { calls: [], estimated_cost_usd_total: 0 };

/** 生成不可の終端エラー（retry非対象）。runJob が status='failed' にする。 */
export class PostGenerationTerminalError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    message = "post generation failed",
  ) {
    super(message);
    this.name = "PostGenerationTerminalError";
  }
}

interface JobRow {
  pattern: string | null;
  trigger: string;
  input: {
    source_url?: string | null;
    user_opinion?: string | null;
    instructions?: string | null;
    image_enabled?: boolean;
    news_item_id?: string | null;
  };
  x_account_id: string;
  user_id: string;
  base_md: string;
  settings: { themes?: { primary?: string[]; secondary?: string[] } } | null;
  plan: string;
}

export interface PostGenerationDeps {
  db: Queryable;
  jobId: string;
  /** plan/userId から TextGen・provider・model を解決する（server配線は resolveTextProvider）。 */
  resolveProvider: (input: {
    plan: string;
    userId: string;
    deadline: Deadline;
  }) => Promise<{ textGen: TextGen; provider: Provider; model: string }>;
  /** 実行前提の入力収集（server配線は gatherExecutionPrereqInputs）。 */
  gatherPrereqInputs: (
    userId: string,
    opts: { imageRequested: boolean },
  ) => Promise<ExecutionPrereqInput | null>;
  now?: () => number;
  makeDeadline?: () => Deadline;
}

export interface PostGenerationResult {
  status: "created" | "already_done";
  draftId: string;
}

function composeUserInput(input: JobRow["input"]): string {
  const parts: string[] = [];
  if (input.source_url) parts.push(`参考URL: ${input.source_url}`);
  if (input.user_opinion) parts.push(`自分の考え: ${input.user_opinion}`);
  if (input.instructions) parts.push(`追加指示: ${input.instructions}`);
  return parts.join("\n");
}

/** パターン別のWeb検索設定（プロンプト設計書 §6の検索回数上限）。P-2はURL指定時のみ。 */
function webSearchForPattern(
  pattern: string,
  hasUrl: boolean,
): { maxUses: number } | undefined {
  switch (pattern) {
    case "p1":
    case "p4":
      return { maxUses: 4 };
    case "p3":
    case "p6":
      return { maxUses: 3 };
    case "p2":
      return hasUrl ? { maxUses: 2 } : undefined;
    default:
      return undefined;
  }
}

async function loadJob(db: Queryable, jobId: string): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `select gj.pattern, gj.trigger, gj.input, gj.x_account_id,
            xa.user_id, xa.base_md, xa.settings, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

async function existingDraftId(db: Queryable, jobId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select id from drafts where source_job_id = $1`,
    [jobId],
  );
  return rows[0]?.id ?? null;
}

async function persistFailure(
  db: Queryable,
  job: { jobId: string; userId: string },
  error: {
    code: string;
    message: string;
    stage: string | null;
    providerRawError?: string | null;
  },
  usage: GenerationUsage,
): Promise<void> {
  await db.query(
    `update generation_jobs set error = $2::jsonb, usage = $3::jsonb where id = $1`,
    [
      job.jobId,
      JSON.stringify({
        code: error.code,
        message: error.message,
        retryable: false,
        stage: error.stage,
        provider_raw_error: error.providerRawError ?? null,
      }),
      JSON.stringify(usage),
    ],
  );
  // error通知（設定を尊重・両channel OFFなら作らない）。ユーザーへは安全なmessageのみ。
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'error', $2, '投稿の生成に失敗しました',
            '時間をおいて再度お試しください。設定や入力もご確認ください。',
            '/app/posts', jsonb_build_object('job_id', $3::text),
            coalesce((p.notification_config->'error'->>'in_app')::boolean, false),
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
            case when coalesce((p.notification_config->'error'->>'email')::boolean, false)
                 then now() else null end
       from profiles p
      where p.id = $1
        and (coalesce((p.notification_config->'error'->>'in_app')::boolean, false)
             or coalesce((p.notification_config->'error'->>'email')::boolean, false))
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [job.userId, `job:${job.jobId}:error`, job.jobId],
  );
}

async function createDraftCreatedNotification(
  db: Queryable,
  params: { userId: string; draftId: string },
): Promise<void> {
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'draft_created', $2, '下書きができました',
            '生成した投稿の下書きを確認・編集できます。',
            '/app/posts', jsonb_build_object('draft_id', $3::text),
            coalesce((p.notification_config->'draft_created'->>'in_app')::boolean, false),
            case when coalesce((p.notification_config->'draft_created'->>'email')::boolean, false)
                 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
            case when coalesce((p.notification_config->'draft_created'->>'email')::boolean, false)
                 then now() else null end
       from profiles p
      where p.id = $1
        and (coalesce((p.notification_config->'draft_created'->>'in_app')::boolean, false)
             or coalesce((p.notification_config->'draft_created'->>'email')::boolean, false))
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, `draft:${params.draftId}:created`, params.draftId],
  );
}

export async function executePostGeneration(
  deps: PostGenerationDeps,
): Promise<PostGenerationResult> {
  const { db, jobId } = deps;
  const now = deps.now ?? Date.now;

  const job = await loadJob(db, jobId);
  if (!job) throw new PostGenerationTerminalError("not_found", "job not found");
  const pattern = (job.pattern ?? "p1") as PromptTemplateKind;

  // 冪等: 既にdraftがあれば再作成しない（worker再実行安全）。
  const already = await existingDraftId(db, jobId);
  if (already) return { status: "already_done", draftId: already };

  const failCtx = { jobId, userId: job.user_id };

  // --- stage: validating（前提再検証）---
  await heartbeat(jobId, "validating");
  const prereqInput = await deps.gatherPrereqInputs(job.user_id, {
    imageRequested: Boolean(job.input.image_enabled),
  });
  const prereqError = prereqInput
    ? checkExecutionPrerequisites(prereqInput)
    : { code: "not_found" as const, missing: [], settingsPath: "/app" };
  if (prereqError) {
    await persistFailure(
      db,
      failCtx,
      { code: prereqError.code, message: "実行前提が不足しています。設定をご確認ください。", stage: "validating" },
      EMPTY_USAGE,
    );
    throw new PostGenerationTerminalError(prereqError.code, "prerequisites unmet");
  }

  // --- stage: research（コンテキスト組み立て）---
  await heartbeat(jobId, "research");
  const system = buildGenSystem(job.base_md);
  const patternPrompt = await resolvePromptTemplate(db, {
    xAccountId: job.x_account_id,
    kind: pattern,
  });
  const recentPosts = await fetchRecentPostBodies(db, job.x_account_id);
  let newsDigest;
  if (pattern === "p6") {
    const themeIds = [
      ...(job.settings?.themes?.primary ?? []),
      ...(job.settings?.themes?.secondary ?? []),
    ];
    newsDigest = await fetchNewsDigest(db, themesToNewsCategories(themeIds));
  }
  const user = buildGenUser({
    pattern: patternPrompt,
    input: composeUserInput(job.input),
    recentPosts,
    newsDigest,
  });

  const deadline = (deps.makeDeadline ?? createDeadline)();
  const { textGen, model } = await deps.resolveProvider({
    plan: job.plan,
    userId: job.user_id,
    deadline,
  });

  // --- stage: writing（生成＋JSON検証＋修復）---
  await heartbeat(jobId, "writing");
  let generated;
  try {
    generated = await runTextGeneration({
      provider: textGen,
      request: {
        system,
        user,
        webSearch: webSearchForPattern(pattern, Boolean(job.input.source_url)),
        timeoutMs: deadline.callTimeoutMs(),
      },
      schema: genOutputSchema,
      model,
      operation: "text_generation",
      now,
    });
  } catch (error) {
    if (error instanceof InvalidProviderOutputError) {
      await persistFailure(
        db,
        failCtx,
        { code: "invalid_output", message: "生成結果を検証できませんでした。もう一度お試しください。", stage: "writing" },
        error.usage,
      );
    }
    throw error; // runJob が status='failed'
  }

  // AIが error を返した場合は job failed（生値はログ用に保存・ユーザーへは安全な文言のみ）。
  if (generated.parsed.error) {
    await persistFailure(
      db,
      failCtx,
      {
        code: "generation_error",
        message: "投稿を生成できませんでした。入力や設定をご確認ください。",
        stage: "writing",
        providerRawError: generated.parsed.error,
      },
      generated.usage,
    );
    throw new PostGenerationTerminalError("generation_error", "provider returned error");
  }

  // --- draft作成（thread=initial_thread同値・weighted_length・ニュース起点はsource_news_item_id）---
  const thread = postsToThread(generated.parsed.posts, generated.parsed.sources);
  const threadJson = JSON.stringify(thread);
  const inserted = await db.query<{ id: string }>(
    `insert into drafts
       (x_account_id, pattern, thread, initial_thread, status, source_job_id, source_news_item_id)
     values ($1, $2, $3::jsonb, $3::jsonb, 'draft', $4, $5)
     on conflict (source_job_id) do nothing
     returning id`,
    [job.x_account_id, pattern, threadJson, jobId, job.input.news_item_id ?? null],
  );
  const draftId = inserted.rows[0]?.id ?? (await existingDraftId(db, jobId));
  if (!draftId) throw new PostGenerationTerminalError("draft_persist_failed");

  await db.query(
    `update generation_jobs set draft_id = $2, usage = $3::jsonb where id = $1`,
    [jobId, draftId, JSON.stringify(generated.usage)],
  );

  await createDraftCreatedNotification(db, { userId: job.user_id, draftId });

  return { status: "created", draftId };
}

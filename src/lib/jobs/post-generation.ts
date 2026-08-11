import { checkExecutionPrerequisites, type ExecutionPrereqInput } from "@/lib/execution-prereqs";
import { PT_FIX, type PromptTemplateKind } from "@/lib/prompts/gen-prompts";
import { resolvePromptTemplate } from "@/lib/prompts/prompt-templates";
import {
  finalizeThread,
  sourceRequired,
} from "@/lib/post/generation-validation";
import { promptThemeLabel } from "@/lib/post/post-theme";
import { themesToNewsCategories } from "@/lib/themes";

import {
  buildGenSystem,
  buildGenUser,
  fetchNewsDigest,
  fetchRecentPostBodies,
} from "../ai/gen-context";
import { AppError } from "@/lib/observability/errors";
import { reduceWebSearchMaxUses } from "../ai/anthropic";
import { PLANS } from "@/lib/plans";

import { genOutputSchema } from "../ai/gen-output";
import { toProviderCall, type ProviderCall } from "../ai/normalize";
import { InvalidProviderOutputError, runTextGeneration, usageFromError } from "../ai/pipeline";
import { estimateProviderCost } from "../ai/pricing";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { reserveUsage } from "../usage/generation-reserve";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { createFailedNotification, resolveFailedNotice } from "./notifications";
import { defaultRecordStage } from "./stale";

/** premium文章生成の月次上限（BYOKは上限なし=undefined）。 */
const PREMIUM_GENERATION_LIMIT = PLANS.premium.usageLimits?.generations;

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
    theme?: string | null;
    image_enabled?: boolean;
    news_item_id?: string | null;
    parent_draft_id?: string | null;
    previous_posts?: string[];
  };
  x_account_id: string;
  /** 今回のattempt番号（leaseで加算済み）。再試行時のWeb検索縮退に使う。 */
  attempt: number;
  user_id: string;
  base_md: string;
  settings: {
    themes?: { primary?: string[]; secondary?: string[] };
    ng?: { words?: string[] };
  } | null;
  plan: string;
}

export interface PostGenerationDeps {
  db: Queryable;
  jobId: string;
  /** 利用枠 reserve/refund を1 transactionで束ねる（server配線は withTransaction）。 */
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
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
  /** 出典URLのSSRF検証（server配線は validateSourceUrlServer）。 */
  validateSource: (url: string) => Promise<boolean>;
  /** P-5引用ポストのfeature flag（OFFなら外部/枠消費前にjobをcanceledにする）。 */
  quotePostEnabled?: boolean;
  now?: () => number;
  makeDeadline?: () => Deadline;
  /** stage 進捗の記録（既定 heartbeat・独自tx）。テストで no-op 化できるよう注入する。 */
  recordStage?: (stage: string) => Promise<void>;
}

export interface PostGenerationResult {
  status: "created" | "already_done";
  draftId: string;
}

/**
 * `<input>` ブロックの本文。**未指定の項目は行を出さない**（「（未指定）」という文字列を
 * 素材として渡すと、モデルがそれを題材だと解釈することがある）。
 *
 * export しているのはテストのため（並び順と分野の扱いを固定する）。
 */
export function composeUserInput(input: JobRow["input"]): string {
  const parts: string[] = [];
  // 分野を先に置く（題材の選び方を最初に縛る・T-M8-28）。未指定なら行を出さず、
  // 従来どおりベースmdの発信テーマからAIが選ぶ。
  const theme = promptThemeLabel(input.theme);
  if (theme) parts.push(`分野: ${theme}`);
  if (input.source_url) parts.push(`参考URL: ${input.source_url}`);
  if (input.user_opinion) parts.push(`自分の考え: ${input.user_opinion}`);
  if (input.instructions) parts.push(`追加指示: ${input.instructions}`);
  return parts.join("\n");
}

/**
 * パターン別のWeb検索設定（プロンプト設計書 §6の検索回数上限）。P-2はURL指定時のみ。
 * 再試行（attempt >= 2）では pause_turn の未完了を避けるため1段階ずつ縮小する（§5.2「4→2」）。
 */
function webSearchForPattern(
  pattern: string,
  hasUrl: boolean,
  attempt = 1,
): { maxUses: number } | undefined {
  const base = baseWebSearchForPattern(pattern, hasUrl);
  if (!base) return undefined;
  let maxUses = base.maxUses;
  for (let i = 1; i < attempt; i++) maxUses = reduceWebSearchMaxUses(maxUses);
  return { maxUses };
}

function baseWebSearchForPattern(
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
    `select gj.pattern, gj.trigger, gj.input, gj.x_account_id, gj.attempt,
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

/**
 * 画像ON時の image_generation 子job作成（要件04 §9, ADR-0002）。決定的 request_key
 * `parent:{parentJobId}:image_generation:{draftId}` ＋ on conflict do nothing で、
 * worker再実行でも重複作成されない。dispatch は親job succeeded 後に runJob が連鎖起動する。
 */
async function ensureImageChildJob(
  db: Queryable,
  params: { parentJobId: string; xAccountId: string; draftId: string },
): Promise<void> {
  await db.query(
    `insert into generation_jobs
       (x_account_id, kind, trigger, parent_job_id, draft_id, request_key, status)
     values ($1, 'image_generation', 'system', $2, $3, $4, 'queued')
     on conflict (request_key) do nothing`,
    [
      params.xAccountId,
      params.parentJobId,
      params.draftId,
      `parent:${params.parentJobId}:image_generation:${params.draftId}`,
    ],
  );
}

async function persistFailure(
  db: Queryable,
  job: { jobId: string; userId: string; xAccountId: string },
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
  // 失敗確定前に発生した provider call の原価も記録する（成功・失敗を問わず記録・要件02 §3.17）。
  await recordProviderCalls(db, usage.calls, {
    userId: job.userId,
    xAccountId: job.xAccountId,
    jobId: job.jobId,
    keyPrefix: `gen:${job.jobId}`,
  });
  // error通知（設定を尊重・両channel OFFなら作らない）。文言の正本は `notifications.ts`。
  await createFailedNotification(db, {
    userId: job.userId,
    jobId: job.jobId,
    ...resolveFailedNotice("post_generation", { draft_id: null }),
  });
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
            '/app/posts?tab=drafts&draftId=' || $3::text, jsonb_build_object('draft_id', $3::text),
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
  const recordStage = deps.recordStage ?? defaultRecordStage(jobId);

  const job = await loadJob(db, jobId);
  if (!job) throw new PostGenerationTerminalError("not_found", "job not found");
  const pattern = (job.pattern ?? "p1") as PromptTemplateKind;

  // P-5 が flag OFF の間に queued 化していた場合、外部API・利用枠を消費する前に canceled にする
  //（要件05 §5・要件04 §1, T-M3-25）。runJob は status='running' の間だけ finalize するため上書きされない。
  if (pattern === "p5" && deps.quotePostEnabled === false) {
    await db.query(
      `update generation_jobs set status = 'canceled', finished_at = now() where id = $1 and status = 'running'`,
      [jobId],
    );
    throw new PostGenerationTerminalError("feature_disabled", "quote post feature disabled");
  }

  // 冪等: 既にdraftがあれば再作成しない（worker再実行安全）。画像ONなら子jobの存在だけ担保する
  //（初回が子job作成前に落ちても再実行で連鎖が成立するようにする。決定的keyで重複しない）。
  const already = await existingDraftId(db, jobId);
  if (already) {
    if (job.input.image_enabled) {
      await ensureImageChildJob(db, {
        parentJobId: jobId,
        xAccountId: job.x_account_id,
        draftId: already,
      });
    }
    return { status: "already_done", draftId: already };
  }

  const failCtx = { jobId, userId: job.user_id, xAccountId: job.x_account_id };

  // premium は文章生成の開始時に生成枠を +1 reserve（月次上限確認・冪等。BYOK/standard/mdは消費しない）。
  // GEN-FIX・JSON修復・出典再生成は同一jobの内部callで追加reserveしない（開始時1回のみ）。
  const isPremium = job.plan === "premium";
  if (isPremium) {
    try {
      await deps.runInTx((tx) =>
        reserveUsage(tx, {
          userId: job.user_id,
          xAccountId: job.x_account_id,
          jobId,
          type: "generation",
          limit: PREMIUM_GENERATION_LIMIT,
        }),
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "usage_limit_exceeded") {
        await persistFailure(
          db,
          failCtx,
          { code: "usage_limit_exceeded", message: "今月の生成上限に達しています。翌月まで自動生成をご利用いただけません。", stage: "validating" },
          EMPTY_USAGE,
        );
        throw new PostGenerationTerminalError("usage_limit_exceeded", "generation limit reached");
      }
      throw error;
    }
  }

  try {
  // --- stage: validating（前提再検証）---
  await recordStage("validating");
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
  await recordStage("research");
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
    previousDraft: job.input.previous_posts,
  });

  const deadline = (deps.makeDeadline ?? createDeadline)();
  const { textGen, provider: textProviderId, model } = await deps.resolveProvider({
    plan: job.plan,
    userId: job.user_id,
    deadline,
  });

  // GEN-FIX 短縮（親jobと同じproviderで実行し、usageは親jobへ合算）。
  const fixCalls: ProviderCall[] = [];
  const shorten = async (text: string, limit: number): Promise<string> => {
    const start = now();
    const out = await textGen.generate({
      system: [],
      user: PT_FIX.replaceAll("{{limit}}", String(limit)).replaceAll("{{post}}", text),
      timeoutMs: deadline.callTimeoutMs(),
    });
    fixCalls.push(
      toProviderCall(out, {
        model,
        operation: "text_generation",
        latencyMs: now() - start,
        estimatedCostUsd: estimateProviderCost(out.provider, out.usage),
      }),
    );
    return out.text.trim();
  };

  const request = {
    system,
    user,
    webSearch: webSearchForPattern(pattern, Boolean(job.input.source_url), job.attempt),
    timeoutMs: deadline.callTimeoutMs(),
  };

  // --- stage: writing（生成＋JSON検証＋修復）---
  await recordStage("writing");
  let generated;
  try {
    generated = await runTextGeneration({
      provider: textGen,
      providerId: textProviderId,
      request,
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
    } else {
      // 例外で終わったcallも原価台帳へ残す（D-4 案A・要件04 §10）。失敗確定か再試行かは
      // runJob が判断するため、ここでは error/通知を書かず記帳だけを行う。
      const failedUsage = usageFromError(error);
      if (failedUsage && failedUsage.calls.length > 0) {
        await recordProviderCalls(db, failedUsage.calls, {
          userId: job.user_id,
          xAccountId: job.x_account_id,
          jobId,
          keyPrefix: `gen:${jobId}`,
        });
      }
    }
    throw error; // runJob が retry か failed かを決める
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

  // --- 生成後検証（GEN-FIX短縮・cashtag・NG・出典SSRF・インジェクション, T-M3-06）---
  const ngWords = job.settings?.ng?.words ?? [];
  const hasReferenceUrl = Boolean(job.input.source_url);
  const usageCalls: ProviderCall[] = [...generated.usage.calls];
  let finalize = await finalizeThread(
    {
      pattern,
      posts: generated.parsed.posts,
      aiSources: generated.parsed.sources,
      ngWords,
      hasReferenceUrl,
    },
    { shorten, validateSource: deps.validateSource },
  );
  // 出典必須で通過出典が空なら1回だけ再生成する（プロンプト設計書 §7.5）。
  if (finalize.sourcesMissing && sourceRequired(pattern, hasReferenceUrl)) {
    const retry = await runTextGeneration({
      provider: textGen,
      providerId: textProviderId,
      request,
      schema: genOutputSchema,
      model,
      operation: "text_generation",
      now,
    });
    usageCalls.push(...retry.usage.calls);
    if (!retry.parsed.error) {
      finalize = await finalizeThread(
        {
          pattern,
          posts: retry.parsed.posts,
          aiSources: retry.parsed.sources,
          ngWords,
          hasReferenceUrl,
        },
        { shorten, validateSource: deps.validateSource },
      );
    }
  }
  usageCalls.push(...fixCalls);
  const usage: GenerationUsage = {
    calls: usageCalls,
    estimated_cost_usd_total: usageCalls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0),
  };

  // --- draft作成（thread=initial_thread同値・weighted_length・警告・ニュース起点はsource_news_item_id）---
  const threadJson = JSON.stringify(finalize.thread);
  const inserted = await db.query<{ id: string }>(
    `insert into drafts
       (x_account_id, pattern, thread, initial_thread, status, source_job_id,
        source_news_item_id, parent_draft_id)
     values ($1, $2, $3::jsonb, $3::jsonb, 'draft', $4, $5, $6)
     on conflict (source_job_id) do nothing
     returning id`,
    [
      job.x_account_id,
      pattern,
      threadJson,
      jobId,
      job.input.news_item_id ?? null,
      job.input.parent_draft_id ?? null,
    ],
  );
  const draftId = inserted.rows[0]?.id ?? (await existingDraftId(db, jobId));
  if (!draftId) throw new PostGenerationTerminalError("draft_persist_failed");

  await db.query(
    `update generation_jobs set draft_id = $2, usage = $3::jsonb where id = $1`,
    [jobId, draftId, JSON.stringify(usage)],
  );
  // 成功した全 provider call（本文生成＋JSON修復＋GEN-FIX）を原価台帳へ冪等記録する（要件02 §3.17）。
  await recordProviderCalls(db, usage.calls, {
    userId: job.user_id,
    xAccountId: job.x_account_id,
    jobId,
    keyPrefix: `gen:${jobId}`,
  });

  // 画像ON: draft_created は画像確定後に子（image_generation）が送るため、ここでは送らず子jobを作成する。
  // 画像OFF: ここで draft_created を送る（要件04 §9・要件06 §6）。
  if (job.input.image_enabled) {
    await ensureImageChildJob(db, {
      parentJobId: jobId,
      xAccountId: job.x_account_id,
      draftId,
    });
  } else {
    await createDraftCreatedNotification(db, { userId: job.user_id, draftId });
  }

  return { status: "created", draftId };
  } catch (error) {
    // 生成枠の返還は runJob の failJob が失敗確定時に行う（要件03 §7.3）。ここで返還すると
    // retryで差し戻される失敗でも返してしまい、次のattemptが再予約できなくなる。
    throw error;
  }
}

import {
  resolveExecutionPrereqError,
  type ExecutionPrereqInput,
} from "@/lib/execution-prereqs";
import { PT_FIX } from "@/lib/prompts/gen-prompts";
import { finalizeThread } from "@/lib/post/generation-validation";
import {
  buildPatternRules,
  fillPlaceholders,
  placeholdersForFill,
  parsePatternSpec,
  patternPrompt,
  sourceRequiredForSpec,
  webSearchForSpec,
} from "@/lib/post/pattern-spec";
import { promptThemeLabel } from "@/lib/post/post-theme";
import { themesToNewsCategories } from "@/lib/themes";

import {
  buildGenSystem,
  buildGenUser,
  fetchNewsDigest,
  fetchRecentPostBodies,
} from "../ai/gen-context";
import { AppError, userMessageForCode } from "@/lib/observability/errors";
import { reduceWebSearchMaxUses } from "../ai/anthropic";

import { genOutputSchema } from "../ai/gen-output";
import { toProviderCall, type ProviderCall } from "../ai/normalize";
import {
  InvalidProviderOutputError,
  providerRawOutputOf,
  runTextGeneration,
  usageFromError,
} from "../ai/pipeline";
import { formatFailureRawError } from "../ai/raw-error";
import { estimateProviderCost } from "../ai/pricing";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { reserveIfPremium, settleIfPremium } from "../usage/reserve-if-premium";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import {
  createDraftCreatedNotification,
  persistJobFailure,
} from "./notifications";
import { ensureAutoPostPublishJob, isAutoMode } from "./publish-chain";
import { defaultRecordStage } from "./stale";

/** premium文章生成の月次上限（BYOKは上限なし=undefined）。 */

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
  pattern_id: string | null;
  /** enqueue時点のパターン設定snapshot。実行中に編集・削除されても走り切るための凍結（U2）。 */
  pattern_spec: unknown;
  trigger: string;
  input: {
    source_url?: string | null;
    instructions?: string | null;
    theme?: string | null;
    image_enabled?: boolean;
    news_item_id?: string | null;
    /** この生成にだけ使うプロンプト（T-M8-92）。 */
    prompt_override?: string | null;
    /** この生成にだけ使うアカウント.md（T-M8-93）。 */
    base_md_override?: string | null;
  /** この生成にだけ使う画像プロンプト（T-M8-93）。子jobへ引き継ぐ。 */
    image_prompt_override?: string | null;
    /** パターンの入力項目（`{名前}` へ差し込む値）。キーは項目名（T-M8-132）。 */
    placeholder_values?: Record<string, string> | null;
    parent_draft_id?: string | null;
    previous_posts?: string[];
    /**
     * 予約の実行モード（`schedule-enqueue` が書く）。`auto` は生成成功後に投稿まで進む
     * （要件04 §10 手順6/7・T-M8-143）。手動起点は未設定＝下書きで止まる。
     */
    mode?: "draft" | "auto";
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
    opts: { imageRequested: boolean; xAccountId?: string },
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
  // 従来どおりアカウント.mdの発信テーマからAIが選ぶ。
  const theme = promptThemeLabel(input.theme);
  if (theme) parts.push(`分野: ${theme}`);
  if (input.source_url) parts.push(`参考URL: ${input.source_url}`);
  if (input.instructions) parts.push(`追加指示: ${input.instructions}`);
  return parts.join("\n");
}

async function loadJob(db: Queryable, jobId: string): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `select gj.pattern_id, gj.pattern_spec, gj.trigger, gj.input, gj.x_account_id, gj.attempt,
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
  params: {
    parentJobId: string;
    xAccountId: string;
    draftId: string;
    /** この生成にだけ使う画像プロンプト／アカウント.md（T-M8-93）。親jobのinputから引き継ぐ。 */
    imagePromptOverride?: string | null;
    baseMdOverride?: string | null;
    /** 親の実行モード。`auto` なら子が画像確定後に投稿jobを作る（T-M8-143）。 */
    mode?: "draft" | "auto";
  },
): Promise<void> {
  // `generation_jobs.input` は NOT NULL（既定 '{}'）。override が無いときも '{}' を渡す
  // （null を渡すと制約違反で子jobが作れない。2026-08-15 に smoke:live で検出・T-M8-93）。
  const input =
    (() => {
      const carried: Record<string, unknown> = {};
      if (params.imagePromptOverride || params.baseMdOverride) {
        carried.image_prompt_override = params.imagePromptOverride ?? null;
        carried.base_md_override = params.baseMdOverride ?? null;
      }
      // **modeは必ず引き継ぐ**（T-M8-143）。子が画像確定後に投稿へ進むかの判断に使う。
      if (params.mode) carried.mode = params.mode;
      return Object.keys(carried).length > 0 ? JSON.stringify(carried) : "{}";
    })();
  await db.query(
    `insert into generation_jobs
       (x_account_id, kind, trigger, parent_job_id, draft_id, request_key, input, status)
     values ($1, 'image_generation', 'system', $2, $3, $4, $5::jsonb, 'queued')
     on conflict (request_key) do nothing`,
    [
      params.xAccountId,
      params.parentJobId,
      params.draftId,
      `parent:${params.parentJobId}:image_generation:${params.draftId}`,
      input,
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
  await persistJobFailure(db, {
    jobId: job.jobId,
    userId: job.userId,
    xAccountId: job.xAccountId,
    keyPrefix: `gen:${job.jobId}`,
    error: {
      code: error.code,
      message: error.message,
      stage: error.stage,
      providerRawError: error.providerRawError ?? null,
    },
    usage,
    notifyKind: "post_generation",
  });
}

export async function executePostGeneration(
  deps: PostGenerationDeps,
): Promise<PostGenerationResult> {
  const { db, jobId } = deps;
  const now = deps.now ?? Date.now;
  const recordStage = deps.recordStage ?? defaultRecordStage(jobId);

  const job = await loadJob(db, jobId);
  if (!job) throw new PostGenerationTerminalError("not_found", "job not found");

  // **パターン設定は凍結された snapshot を正にする**（T-M8-129 U2・ADR-0008）。
  // 実行中にパターンを編集・削除されても、このjobは enqueue 時点の設定で完走する。
  // **読めないときは既定で補わず失敗させる**。どの設定で生成したのか分からない下書きを
  // 作る方が害が大きい（CLAUDE.md 原則1）。
  const spec = parsePatternSpec(job.pattern_spec);
  if (!spec) {
    throw new PostGenerationTerminalError(
      "pattern_spec_missing",
      "generation_jobs.pattern_spec is missing or malformed",
    );
  }

  // 引用ポストが flag OFF の間に queued 化していた場合、外部API・利用枠を消費する前に canceled にする
  //（要件05 §5・要件04 §1, T-M3-25）。runJob は status='running' の間だけ finalize するため上書きされない。
  if (spec.requiresQuoteUrl && deps.quotePostEnabled === false) {
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
        imagePromptOverride: job.input.image_prompt_override,
        baseMdOverride: job.input.base_md_override,
      });
    }
    return { status: "already_done", draftId: already };
  }

  const failCtx = { jobId, userId: job.user_id, xAccountId: job.x_account_id };

  // premium は文章生成の開始時に生成枠を +1 reserve（契約期間ごとの上限確認・冪等。BYOK/standard/mdは消費しない）。
  // GEN-FIX・JSON修復・出典再生成は同一jobの内部callで追加reserveしない（開始時1回のみ）。
  {
    try {
      await reserveIfPremium(deps.runInTx, {
        plan: job.plan,
        userId: job.user_id,
        xAccountId: job.x_account_id,
        jobId,
        type: "generation",
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "usage_paused") {
        // エキスパートの内部ガード（T-M8-168）。保存する理由にも数値・「上限」の語を出さない。
        await persistFailure(
          db,
          failCtx,
          { code: "usage_paused", message: "連続的な使用が検知されたため一時的に停止しております。お待ちください。", stage: "validating" },
          EMPTY_USAGE,
        );
        throw new PostGenerationTerminalError("usage_paused", "usage paused (concealed limit reached)");
      }
      if (error instanceof AppError && error.code === "usage_limit_exceeded") {
        await persistFailure(
          db,
          failCtx,
          // 文言は errors.ts の既定文と同じ（利用枠は契約期間ごと・T-M8-258）。
          { code: "usage_limit_exceeded", message: userMessageForCode("usage_limit_exceeded"), stage: "validating" },
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
  // 判定は**ジョブの対象アカウント**基準（T-M8-196）。activeアカウント基準だと、
  // 別アカウントを設定中・失効中なだけで健全なアカウントの生成が失敗する。
  const prereqInput = await deps.gatherPrereqInputs(job.user_id, {
    imageRequested: Boolean(job.input.image_enabled),
    xAccountId: job.x_account_id,
  });
  // throw せず code だけを失敗確定へ回すので、判定だけを共有関数から借りる。
  const prereqError = resolveExecutionPrereqError(prereqInput);
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
  // この生成にだけ使うアカウント.md（T-M8-93）。指定があれば保存版の代わりに使う（保存はしない）。
  // systemが保存版と別バイト列になるためプロンプトキャッシュはこの回だけ効かない（意図した挙動）。
  const baseMdOverride =
    typeof job.input?.base_md_override === "string" && job.input.base_md_override.trim() !== ""
      ? job.input.base_md_override
      : null;
  const system = buildGenSystem(baseMdOverride ?? job.base_md);
  // この生成にだけ使うプロンプト（T-M8-92）。指定があれば通常の解決を飛ばす。
  // 保存はしない——恒久化は投稿作成画面の「保存して以後も使う」かAI設定＞プロンプトが担う。
  const promptOverride =
    typeof job.input?.prompt_override === "string" && job.input.prompt_override.trim() !== ""
      ? job.input.prompt_override
      : null;
// パターンのプロンプト。`prompt` が null ならシステム既定（コード定数）を使う。
  const basePatternPrompt = promptOverride ?? patternPrompt(spec);
  // 利用者が決めた入力項目を `{名前}` へ差し込む（T-M8-132）。
  const resolvedPatternPrompt =
    basePatternPrompt === null
      ? null
      : fillPlaceholders(
          basePatternPrompt,
          // 上書きプロンプトで増やした {名前} も差し込む（T-M8-186）。
          placeholdersForFill(basePatternPrompt, spec.placeholders, job.input.placeholder_values ?? {}),
          job.input.placeholder_values ?? {},
        );
  if (resolvedPatternPrompt === null) {
    throw new PostGenerationTerminalError(
      "pattern_prompt_missing",
      `pattern "${spec.name}" has no prompt`,
    );
  }
  const recentPosts = await fetchRecentPostBodies(db, job.x_account_id);
  let newsDigest;
  if (spec.includeNewsDigest) {
    const themeIds = [
      ...(job.settings?.themes?.primary ?? []),
      ...(job.settings?.themes?.secondary ?? []),
    ];
    newsDigest = await fetchNewsDigest(db, themesToNewsCategories(themeIds));
  }
const hasInputUrl = Boolean(job.input.source_url);
  const webSearch = webSearchForSpec(spec, hasInputUrl, job.attempt, reduceWebSearchMaxUses);
  const user = buildGenUser({
    pattern: resolvedPatternPrompt,
    // 設定（分量・Web検索・参考URL）をAIへ明示する（T-M8-131）。
    // Web検索の回数は再試行での縮退を反映した実際の値を渡す。
    patternRules: buildPatternRules(spec, {
      hasInputUrl,
      webSearchMaxUses: webSearch?.maxUses ?? null,
    }),
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
    webSearch,
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
      // **AIが何を返して落ちたか**を残す（F4）。これが無いと code だけが記録され、
      // 検証失敗という最も多い失敗の原因を運営者が辿れない（CLAUDE.md 原則2）。
      // 画面へは出さない（要件06 §5。ブラウザへ渡らないことは getGenerationJob 側で担保）。
      await persistFailure(
        db,
        failCtx,
        {
          code: "invalid_output",
          message: "生成結果を検証できませんでした。もう一度お試しください。",
          stage: "writing",
          providerRawError: formatFailureRawError(error, providerRawOutputOf(error)),
        },
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
  const needsSource = sourceRequiredForSpec(spec, hasReferenceUrl);
  let finalize = await finalizeThread(
    {
      maxPosts: spec.maxPosts,
      sourceRequired: needsSource,
      posts: generated.parsed.posts,
      aiSources: generated.parsed.sources,
      ngWords,
      hasReferenceUrl,
    },
    { shorten, validateSource: deps.validateSource },
  );
  // 出典必須で通過出典が空なら1回だけ再生成する（プロンプト設計書 §7.5）。
  if (finalize.sourcesMissing && needsSource) {
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
          maxPosts: spec.maxPosts,
          sourceRequired: needsSource,
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
    // **パターンの写しを明示的に入れる**（U2/U3）。名前・上限・引用必須をここで凍結するので、
    // 後からパターンを編集・削除しても履歴の表示と本文の再検証が変わらない。
    `insert into drafts
       (x_account_id, pattern_id, pattern_name, max_posts, max_posts_edit, requires_quote_url,
        thread, initial_thread, status, source_job_id,
        source_news_item_id, parent_draft_id)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $7::jsonb, 'draft', $8, $9, $10)
     on conflict (source_job_id) do nothing
     returning id`,
    [
      job.x_account_id,
      job.pattern_id,
      spec.name,
      spec.maxPosts,
      // 編集上限は実際に作ったポスト数を下回らせない（作った直後に編集できない下書きを作らない）。
      Math.max(spec.maxPostsEdit, finalize.thread.length),
      spec.requiresQuoteUrl,
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
  // AIクレジットを実費で精算（premium・T-M8-109）。見積もりreserveとの差分を調整する。
  await settleIfPremium(deps.runInTx, {
    plan: job.plan,
    userId: job.user_id,
    xAccountId: job.x_account_id,
    jobId,
    type: "generation",
    estimatedCostUsdTotal: usage.estimated_cost_usd_total,
  });

  // 画像ON: draft_created は画像確定後に子（image_generation）が送るため、ここでは送らず子jobを作成する。
  // 画像OFF: ここで draft_created を送る（要件04 §9・要件06 §6）。
  if (job.input.image_enabled) {
    await ensureImageChildJob(db, {
      parentJobId: jobId,
      xAccountId: job.x_account_id,
      draftId,
      imagePromptOverride: job.input.image_prompt_override,
      baseMdOverride: job.input.base_md_override,
      // 画像確定後に投稿へ進むかを子へ伝える（子は親のinputを見られない・T-M8-143）。
      mode: job.input.mode,
    });
  } else if (isAutoMode(job.input)) {
    /*
      **auto は投稿へ進む**（要件04 §10 手順6・T-M8-143）。ここが無かったため、
      予約の自動投稿は下書きを作るだけで投稿されていなかった。
      `draft_created` は送らない——投稿されるので「下書きができました」は誤った案内になる。
      阻害警告と自動投稿同意の確認は `post-publish` が投稿直前に行い、止めた理由をdraftへ残す。
    */
    await ensureAutoPostPublishJob(db, { xAccountId: job.x_account_id, draftId });
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

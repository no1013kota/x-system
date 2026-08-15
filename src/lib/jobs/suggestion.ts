import { z } from "zod";

import { providerRawOutputOf, runTextGeneration, usageFromError } from "../ai/pipeline";
import { formatFailureRawError } from "../ai/raw-error";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { THEME_IDS, THEME_OPTIONS } from "../themes";
import { PT_SUGGEST } from "../prompts/gen-prompts";
import { PROMPT_TEMPLATE_MAX_CHARS } from "../prompts/prompt-templates";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { persistJobFailure } from "./notifications";
import { defaultRecordStage } from "./stale";
import type { SuggestionInput } from "./suggestion-input";
import { SUGGEST_ANALYZE_MAX } from "./suggestion-timeline";

/**
 * suggestion worker（SUGGEST, K-2, プロンプト §6.15/§4.2, 要件04 §12, 要件02 §3.12/§4.11, T-M8-91）。
 *
 * 2026-08-15 刷新: Xタイムラインの投稿（Exos製かに依らない・最新100件から増分蓄積）を PT-SUGGEST で自由分析し、
 * **1件の提案**（良かった投稿の特徴 summary＋実行可能な advice: 型・テーマ・画像・そのまま貼れるプロンプト全文）
 * を improvement_suggestions へ保存する。固定の分析軸と「3投稿以上・差20%」条件は廃止。
 * 保存形は evidence.format=2 で旧形式（axis等）と区別する。
 *
 * T-M8-94 で**毎朝8:00 JSTの自動実行**になった（起票は scheduler_tick・request_key冪等で1日1回）。
 * X取得はハンドラ側（suggestion-server）が増分＋48h重なりで行い、保存済み全投稿（新しい順に最大
 * SUGGEST_ANALYZE_MAX 件）を分析する。**自動実行のため premium の生成枠は消費しない**
 * （利用者の操作なしで枠が減るのを避ける。費用は原価台帳で見える）。base_md は読まない。
 */

export class SuggestionTerminalError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: string,
    message = "suggestion failed",
  ) {
    super(message);
    this.name = "SuggestionTerminalError";
  }
}

/** advice.pattern の選択肢。p5（引用）はfeature flag停止中のため提案させない。 */
export const SUGGESTABLE_PATTERNS = ["p1", "p2", "p3", "p4", "p6"] as const;

/**
 * PT-SUGGEST 出力スキーマ（T-M8-91）。
 * good_posts.id は `<posts>`内IDのみ（修復1回は runTextGeneration が担う）。
 * prompt.content の上限は AI設定＞プロンプトの保存上限（8,000字）と同じにする——
 * 「そのまま貼れる」が要件なので、貼った先で保存できない長さを許さない。
 */
function makeSuggestionSchema(allowedIds: Set<string>) {
  const reasoned = <T extends z.ZodTypeAny>(recommended: T) =>
    z.object({ recommended, reason: z.string().min(1) });
  return z.object({
    summary: z.string().min(1),
    good_posts: z
      .array(z.object({ id: z.string().min(1), why: z.string().min(1) }))
      .min(1)
      .max(3)
      .refine((items) => items.every((i) => allowedIds.has(i.id)), {
        message: "good_posts[].id must be a subset of <posts> ids",
      }),
    advice: z
      .object({
        pattern: reasoned(z.enum(SUGGESTABLE_PATTERNS)),
        // 「その他」は提案として実行可能でない（追加指示に書く意思表示）ため6テーマに限定する。
        theme: reasoned(z.enum(THEME_IDS)),
        image: reasoned(z.boolean()),
        prompt: z.object({
          kind: z.enum(SUGGESTABLE_PATTERNS),
          content: z.string().min(1).max(PROMPT_TEMPLATE_MAX_CHARS),
        }),
      })
      .refine((a) => a.prompt.kind === a.pattern.recommended, {
        message: "advice.prompt.kind must equal advice.pattern.recommended",
      }),
  });
}

export type SuggestionOutput = z.infer<ReturnType<typeof makeSuggestionSchema>>;

export type RunInTx = <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;

export interface SuggestionDeps {
  db: Queryable;
  jobId: string;
  runInTx: RunInTx;
  resolveProvider: (input: {
    plan: string;
    userId: string;
    deadline: Deadline;
  }) => Promise<{ textGen: TextGen; provider: Provider; model: string }>;
  /**
   * Xタイムライン（初回は最新100件・以後は増分・メトリクス付き）＋Exos投稿の型/テーマタグを整形済みで返す。
   * server側（suggestion-server）が token 復号・読取・drafts 突合を担う。
   */
  fetchPosts: (job: { xAccountId: string; xUserId: string; userId: string }) => Promise<SuggestionInput>;
  now?: () => number;
  makeDeadline?: () => Deadline;
  recordStage?: (stage: string) => Promise<void>;
}

export interface SuggestionResult {
  status: "saved" | "no_suggestions";
  count: number;
}

interface JobRow {
  x_account_id: string;
  x_user_id: string;
  user_id: string;
  plan: string;
}

async function loadJob(db: Queryable, jobId: string): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `select gj.x_account_id, xa.x_user_id, xa.user_id, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

/** テーマの選択肢を「id=ラベル」で列挙する（LLMがidを選び、理由をラベルで書けるように）。 */
function themeChoices(): string {
  return THEME_OPTIONS.map((t) => `${t.id}=${t.label}`).join(" / ");
}

function renderPrompt(input: SuggestionInput): string {
  return PT_SUGGEST.replaceAll("{{themes}}", themeChoices()).replaceAll(
    "{{posts}}",
    JSON.stringify(input.posts),
  );
}

async function persistFailure(
  db: Queryable,
  params: {
    userId: string;
    xAccountId: string;
    jobId: string;
    code: string;
    message: string;
    stage: "research" | "writing";
    usage: GenerationUsage;
    /** AIが何を返して落ちたか（F5）。X取得失敗時は null。 */
    providerRawError: string | null;
  },
): Promise<void> {
  await persistJobFailure(db, {
    jobId: params.jobId,
    userId: params.userId,
    xAccountId: params.xAccountId,
    keyPrefix: `sug:${params.jobId}`,
    error: {
      code: params.code,
      message: params.message,
      stage: params.stage,
      providerRawError: params.providerRawError,
    },
    usage: params.usage,
    notifyKind: "suggestion",
  });
}

export async function executeSuggestion(deps: SuggestionDeps): Promise<SuggestionResult> {
  const { db, jobId } = deps;
  const now = deps.now ?? Date.now;
  const recordStage = deps.recordStage ?? defaultRecordStage(jobId);

  const job = await loadJob(db, jobId);
  if (!job) throw new SuggestionTerminalError("not_found", "job not found");

  await recordStage("research");
  let input: SuggestionInput;
  try {
    input = await deps.fetchPosts({
      xAccountId: job.x_account_id,
      xUserId: job.x_user_id,
      userId: job.user_id,
    });
  } catch (error) {
    // X取得の失敗は「静かに0件」にしない（原則1）。理由を保存して通知する。
    await persistFailure(db, {
      userId: job.user_id,
      xAccountId: job.x_account_id,
      jobId,
      code: "x_fetch_failed",
      message: "Xから投稿を取得できませんでした。時間をおいてもう一度お試しください。",
      stage: "research",
      usage: { calls: [], estimated_cost_usd_total: 0 },
      providerRawError: null,
    });
    throw new SuggestionTerminalError("x_fetch_failed", String(error));
  }

  // 分析対象の投稿が1件も無ければ（Xに投稿が無い・保存も空）、LLMを呼ばずレポート0件で正常終了。
  if (input.posts.length === 0) {
    return { status: "no_suggestions", count: 0 };
  }

  try {
    await recordStage("writing");
    const deadline = (deps.makeDeadline ?? createDeadline)();
    const { textGen, provider: textProviderId, model } = await deps.resolveProvider({
      plan: job.plan,
      userId: job.user_id,
      deadline,
    });
    const allowedIds = new Set(input.posts.map((p) => p.id));
    const result = await runTextGeneration({
      provider: textGen,
      providerId: textProviderId,
      request: {
        system: [renderPrompt(input)],
        user: "上記の投稿一覧を分析し、指定のJSONで出力してください。",
        timeoutMs: deadline.callTimeoutMs(),
      },
      schema: makeSuggestionSchema(allowedIds),
      model,
      operation: "text_generation",
      now,
    });

    const output = result.parsed;
    // 1件の提案として保存する（content=summary、evidence.format=2 で旧形式と区別・§4.11）。
    await deps.runInTx(async (tx) => {
      await tx.query(
        `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
         values ($1, $2, $3, $4::jsonb)`,
        [
          job.x_account_id,
          jobId,
          output.summary,
          JSON.stringify({
            format: 2,
            good_posts: output.good_posts,
            advice: output.advice,
            // 分析対象＝保存済みの全投稿（新しい順に上限件数）。件数を根拠として残す（T-M8-94）。
            post_count: input.posts.length,
            analyze_limit: SUGGEST_ANALYZE_MAX,
          }),
        ],
      );
      await tx.query(`update generation_jobs set usage = $2::jsonb where id = $1`, [
        jobId,
        JSON.stringify(result.usage),
      ]);
    });
    // 提案生成の provider call を原価台帳へ冪等記録する（poolで確定・要件02 §3.17）。
    await recordProviderCalls(db, result.usage.calls, {
      userId: job.user_id,
      xAccountId: job.x_account_id,
      jobId,
      keyPrefix: `sug:${jobId}`,
    });
    return { status: "saved", count: 1 };
  } catch (error) {
    const usage: GenerationUsage =
      usageFromError(error) ?? { calls: [], estimated_cost_usd_total: 0 };
    const code = error instanceof SuggestionTerminalError ? error.code : "suggestion_failed";
    await persistFailure(db, {
      userId: job.user_id,
      xAccountId: job.x_account_id,
      jobId,
      code,
      message: "投稿分析に失敗しました。",
      stage: "writing",
      usage,
      // refine 失敗（`<posts>` に無いIDを返した等）の中身は運営者が最も知りたい情報（F5）。
      providerRawError: formatFailureRawError(error, providerRawOutputOf(error)),
    });
    // 生成枠の返還は runJob の failJob が失敗確定時に行う（要件03 §7.3）。
    throw error instanceof SuggestionTerminalError
      ? error
      : new SuggestionTerminalError("suggestion_failed", "suggestion failed");
  }
}

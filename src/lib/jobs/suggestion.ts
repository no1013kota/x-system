import { z } from "zod";

import { runTextGeneration, usageFromError } from "../ai/pipeline";
import type { Provider, TextGen } from "../ai/types";
import type { GenerationUsage } from "../ai/usage-schema";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { PT_SUGGEST } from "../prompts/gen-prompts";
import { reserveIfPremium } from "../usage/reserve-if-premium";
import type { Queryable } from "../x/token-refresh";
import { createDeadline, type Deadline } from "./deadline";
import { persistJobFailure } from "./notifications";
import { defaultRecordStage } from "./stale";
import {
  SUGGEST_MIN_GROUP,
  buildSuggestionInput,
  type SuggestionInput,
  SUGGESTION_AXES,
  type SuggestionInputDraft,
} from "./suggestion-input";

/**
 * suggestion worker（SUGGEST, K-2, プロンプト §6.15/§4.2, 要件04 §12, 要件02 §3.12/§4.11, T-M5-18）。
 * コード集計（buildSuggestionInput）の <stats>/<posts> を PT-SUGGEST で分析し、最大2件・evidence.tweet_ids は
 * <posts>内IDのみ（zod refineで検証→修復1回は runTextGeneration が担う）を improvement_suggestions へ保存する
 * （evidence.window_days=30 をコードで付与）。比較グループ不足（対象<3件）はLLMを呼ばず提案0件で正常終了。
 * base_md は読まない。premium はLLM実行時に生成枠 +1 reserve し最終失敗で refund（冪等）。BYOKは消費しない。
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

/** PT-SUGGEST 出力スキーマ（最大2件・evidence.tweet_ids は allowed=<posts>内IDのみ）。 */
function makeSuggestionSchema(allowedIds: Set<string>) {
  return z.object({
    suggestions: z
      .array(
        z.object({
          content: z.string().min(1),
          evidence: z.object({
            tweet_ids: z
              .array(z.string().min(1))
              .min(1)
              .refine((ids) => ids.every((id) => allowedIds.has(id)), {
                message: "evidence.tweet_ids must be a subset of <posts> ids",
              }),
            /** どの軸で差が出たか（T-M7-38）。何を根拠にした提案かを後から辿れるようにする。 */
            axis: z.enum(SUGGESTION_AXES),
            metric: z.string().min(1),
            checkpoint_days: z.union([z.literal(1), z.literal(7), z.literal(30)]),
            diff_pct: z.number(),
            summary: z.string().min(1),
          }),
        }),
      )
      .max(2),
  });
}

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
  /** 集計対象の draft（posted＋remaining有りfailed・直近30日・thread/tweet_metrics付き）。 */
  fetchDrafts: (xAccountId: string) => Promise<SuggestionInputDraft[]>;
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
  user_id: string;
  plan: string;
}

async function loadJob(db: Queryable, jobId: string): Promise<JobRow | null> {
  const { rows } = await db.query<JobRow>(
    `select gj.x_account_id, xa.user_id, p.plan
       from generation_jobs gj
       join x_accounts xa on xa.id = gj.x_account_id
       join profiles p on p.id = xa.user_id
      where gj.id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

function renderPrompt(input: SuggestionInput): string {
  return PT_SUGGEST.replaceAll("{{stats}}", JSON.stringify(input.stats)).replaceAll(
    "{{posts}}",
    JSON.stringify(input.posts),
  );
}

async function persistFailure(
  db: Queryable,
  params: { userId: string; xAccountId: string; jobId: string; code: string; usage: GenerationUsage },
): Promise<void> {
  // `providerRawError` を渡さない＝ error JSON に `provider_raw_error` キーを作らない
  // （他2つのjobとの意図的な差。suggestion.db.test.ts がキー集合を固定している）。
  await persistJobFailure(db, {
    jobId: params.jobId,
    userId: params.userId,
    xAccountId: params.xAccountId,
    keyPrefix: `sug:${params.jobId}`,
    error: { code: params.code, message: "改善提案の生成に失敗しました。", stage: "writing" },
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
  const drafts = await deps.fetchDrafts(job.x_account_id);
  const input = buildSuggestionInput(drafts, now());

  // 比較グループ不足（対象<3件では型×時間帯3件の比較が成立しない）はLLMを呼ばず提案0件で正常終了。
  // reserve もしない（実行=LLM呼び出し時のみ生成枠を消費する）。
  if (input.posts.length < SUGGEST_MIN_GROUP) {
    return { status: "no_suggestions", count: 0 };
  }

  await reserveIfPremium(deps.runInTx, {
    plan: job.plan,
    userId: job.user_id,
    xAccountId: job.x_account_id,
    jobId,
    type: "generation",
  });

  try {
    await recordStage("writing");
    const deadline = (deps.makeDeadline ?? createDeadline)();
    const { textGen, provider: textProviderId, model } = await deps.resolveProvider({
      plan: job.plan,
      userId: job.user_id,
      deadline,
    });
    const allowedIds = new Set(input.posts.map((p) => p.tweet_id));
    const result = await runTextGeneration({
      provider: textGen,
      providerId: textProviderId,
      request: {
        system: [renderPrompt(input)],
        user: "上記の実績データから改善提案をJSONで出力してください。",
        timeoutMs: deadline.callTimeoutMs(),
      },
      schema: makeSuggestionSchema(allowedIds),
      model,
      operation: "text_generation",
      now,
    });

    const suggestions = result.parsed.suggestions;
    // 保存とusage確定を同一tx（source_job_id=jobId、evidence.window_days=30 をコードで付与・§4.11）。
    await deps.runInTx(async (tx) => {
      for (const s of suggestions) {
        await tx.query(
          `insert into improvement_suggestions (x_account_id, source_job_id, content, evidence)
           values ($1, $2, $3, $4::jsonb)`,
          [job.x_account_id, jobId, s.content, JSON.stringify({ ...s.evidence, window_days: 30 })],
        );
      }
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
    return { status: suggestions.length > 0 ? "saved" : "no_suggestions", count: suggestions.length };
  } catch (error) {
    const usage: GenerationUsage =
      usageFromError(error) ?? { calls: [], estimated_cost_usd_total: 0 };
    const code = error instanceof SuggestionTerminalError ? error.code : "suggestion_failed";
    await persistFailure(db, { userId: job.user_id, xAccountId: job.x_account_id, jobId, code, usage });
    // 生成枠の返還は runJob の failJob が失敗確定時に行う（要件03 §7.3）。
    throw error instanceof SuggestionTerminalError
      ? error
      : new SuggestionTerminalError("suggestion_failed", "suggestion failed");
  }
}

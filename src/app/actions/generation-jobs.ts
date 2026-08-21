"use server";

import { after } from "next/server";

import { type BaseResult, errorResult, requireExecutionUserId, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { pooledQueryable, runInPooledTx } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { dispatchJob } from "@/lib/jobs/dispatch";
import {
  cancelGenerationJob,
  createDraftFromNews,
  createGenerationJob,
  createGenerationJobSchema,
  getGenerationJob,
  jobIdSchema,
  publishDraft,
  publishDraftSchema,
  regenerateDraft,
  regenerateDraftSchema,
  regenerateImage,
  regenerateImageSchema,
  retryGenerationJob,
  retryJobSchema,
  type GenerationJobDeps,
  type GenerationJobView,
} from "@/lib/jobs/generation-jobs";
import { z } from "zod";

/**
 * 生成jobの Server Actions（要件05 §5, T-M3-07）。本人のみ。zod検証・前提/所有権/冪等/5件制限は
 * 中核（generation-jobs.ts）で行い、ここで pool・前提収集・feature flag を束ね、新規作成時のみ
 * `after()` で worker へ dispatch する。
 */

const pooledDb = pooledQueryable();

const jobDeps: GenerationJobDeps = {
  runInTx: runInPooledTx,
  gatherPrereqInputs: (userId, opts) => gatherExecutionPrereqInputs(userId, opts),
  quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
};

interface JobIdResult extends BaseResult {
  jobId?: string;
}

export async function createGenerationJobAction(input: unknown): Promise<JobIdResult> {
  const parsed = parseUserInput(createGenerationJobSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await createGenerationJob(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "生成を開始しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * SC-06 の入力。x_account_id は**表示中アカウントをクライアントが送る**（T-M8-196・レビュー修正）。
 * サーバ解決だけに頼ると、別タブで切り替えた後に「画面はAなのにBへ生成」が起きる
 * （通常経路の createGenerationJobAction と同じ assertActiveAccount で不一致を拒否する）。
 */
const createDraftFromNewsActionSchema = z.object({
  request_key: z.string().min(1).max(200),
  news_item_id: z.string().uuid(),
  x_account_id: z.string().uuid(),
  instructions: z.string().max(2000).nullish(),
  image_enabled: z.boolean().optional(),
});

export async function createDraftFromNewsAction(input: unknown): Promise<JobIdResult> {
  const parsed = parseUserInput(createDraftFromNewsActionSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await createDraftFromNews(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "生成を開始しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function retryGenerationJobAction(input: unknown): Promise<JobIdResult> {
  const parsed = parseUserInput(retryJobSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await retryGenerationJob(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "再試行を開始しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function regenerateDraftAction(input: unknown): Promise<JobIdResult> {
  const parsed = parseUserInput(regenerateDraftSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await regenerateDraft(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "再生成を開始しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function regenerateImageAction(input: unknown): Promise<JobIdResult> {
  const parsed = parseUserInput(regenerateImageSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await regenerateImage(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "画像を再生成しています。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function publishDraftAction(input: unknown): Promise<JobIdResult> {
  const parsed = parseUserInput(publishDraftSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await publishDraft(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "投稿を開始しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function getGenerationJobAction(
  input: unknown,
): Promise<BaseResult & { job?: GenerationJobView }> {
  const parsed = parseUserInput(jobIdSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const job = await getGenerationJob(pooledDb, auth.userId, parsed.data.job_id);
    return { job, message: "", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function cancelGenerationJobAction(
  input: unknown,
): Promise<BaseResult & { jobStatus?: string }> {
  const parsed = parseUserInput(jobIdSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { status } = await cancelGenerationJob(pooledDb, auth.userId, parsed.data.job_id);
    return { jobStatus: status, message: "生成をキャンセルしました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

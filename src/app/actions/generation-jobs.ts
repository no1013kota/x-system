"use server";

import { after } from "next/server";

import {
  errorResult,
  requireExecutionUserId,
  requireUserId,
  type BaseResult,
} from "./_helpers";
import { pooledQueryable, runInPooledTx } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
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
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";
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
  const parsed = createGenerationJobSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
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

/** SC-06 の入力（x_account_id は表示中アカウントをサーバで解決するため受け取らない）。 */
const createDraftFromNewsActionSchema = z.object({
  request_key: z.string().min(1).max(200),
  news_item_id: z.string().uuid(),
  instructions: z.string().max(2000).nullish(),
  image_enabled: z.boolean().optional(),
});

export async function createDraftFromNewsAction(input: unknown): Promise<JobIdResult> {
  const parsed = createDraftFromNewsActionSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  const activeId = await resolveActiveXAccountForUser(auth.userId);
  if (!activeId) {
    return {
      ...toUserFacingError(new AppError("not_found", { details: { settingsPath: "/app/settings?tab=api-keys" } })),
      message: "先にXアカウントを連携してください。",
      status: "error",
    };
  }
  try {
    const { jobId, deduped } = await createDraftFromNews(
      auth.userId,
      { ...parsed.data, x_account_id: activeId },
      jobDeps,
    );
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "生成を開始しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function retryGenerationJobAction(input: unknown): Promise<JobIdResult> {
  const parsed = retryJobSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
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
  const parsed = regenerateDraftSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
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
  const parsed = regenerateImageSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
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
  const parsed = publishDraftSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
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
  const parsed = jobIdSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
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
  const parsed = jobIdSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
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

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

/*
  旧 createDraftFromNewsAction（SC-06からの直接job作成）はT-M8-210で削除。
  「すぐに投稿作成」は投稿作成画面への遷移＋{ニュース}自動入力になった（news_item_idは
  通常の createGenerationJobAction が受けて作成済みバッジへつながる）。
*/
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

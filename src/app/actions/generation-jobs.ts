"use server";

import { after } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getPool, withTransaction } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
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
import type { Queryable } from "@/lib/x/token-refresh";

/**
 * 生成jobの Server Actions（要件05 §5, T-M3-07）。本人のみ。zod検証・前提/所有権/冪等/5件制限は
 * 中核（generation-jobs.ts）で行い、ここで pool・前提収集・feature flag を束ね、新規作成時のみ
 * `after()` で worker へ dispatch する。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

const jobDeps: GenerationJobDeps = {
  runInTx: (fn) => withTransaction((client) => fn(client as unknown as Queryable)),
  gatherPrereqInputs: (userId, opts) => gatherExecutionPrereqInputs(userId, opts),
  quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
};

interface BaseResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
}
interface JobIdResult extends BaseResult {
  jobId?: string;
}

async function requireUserId(): Promise<
  { ok: true; userId: string } | { ok: false; result: BaseResult }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      result: { ...toUserFacingError(new AppError("unauthorized")), status: "error" },
    };
  }
  return { ok: true, userId: user.id };
}

export async function createGenerationJobAction(input: unknown): Promise<JobIdResult> {
  const parsed = createGenerationJobSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await createGenerationJob(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "生成を開始しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function retryGenerationJobAction(input: unknown): Promise<JobIdResult> {
  const parsed = retryJobSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await retryGenerationJob(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "再試行を開始しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function regenerateDraftAction(input: unknown): Promise<JobIdResult> {
  const parsed = regenerateDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await regenerateDraft(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "再生成を開始しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function regenerateImageAction(input: unknown): Promise<JobIdResult> {
  const parsed = regenerateImageSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await regenerateImage(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "画像を再生成しています。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function publishDraftAction(input: unknown): Promise<JobIdResult> {
  const parsed = publishDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await publishDraft(auth.userId, parsed.data, jobDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "投稿を開始しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function getGenerationJobAction(
  input: unknown,
): Promise<BaseResult & { job?: GenerationJobView }> {
  const parsed = jobIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const job = await getGenerationJob(pooledDb, auth.userId, parsed.data.job_id);
    return { job, message: "", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function cancelGenerationJobAction(
  input: unknown,
): Promise<BaseResult & { jobStatus?: string }> {
  const parsed = jobIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { status } = await cancelGenerationJob(pooledDb, auth.userId, parsed.data.job_id);
    return { jobStatus: status, message: "生成をキャンセルしました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

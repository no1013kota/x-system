"use server";

import { after } from "next/server";

import { requireUserId, type BaseResult } from "./_helpers";
import { pooledQueryable, runInPooledTx } from "@/lib/db/pool";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { dispatchJob } from "@/lib/jobs/dispatch";
import {
  addLearningSource,
  addLearningSourceSchema,
  listLearningSources,
  reimportOwnPosts,
  reimportOwnPostsSchema,
  removeLearningSource,
  removeLearningSourceSchema,
  type LearningSourceDeps,
  type LearningSourceView,
} from "@/lib/learning-sources";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

/**
 * 学習ソースCRUDの Server Actions（要件05 §8, T-M5-02）。本人のみ。zod検証・前提/所有権/冪等/限度・
 * 5件制限は中核（learning-sources.ts）で行い、ここで pool・前提収集を束ね、job作成時のみ after() で
 * worker へ dispatch する。
 */

const pooledDb = pooledQueryable();

const learningDeps: LearningSourceDeps = {
  runInTx: runInPooledTx,
  gatherPrereqInputs: (userId, opts) => gatherExecutionPrereqInputs(userId, opts),
};

export async function listLearningSourcesAction(): Promise<
  BaseResult & { sources?: LearningSourceView[] }
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  const activeId = await resolveActiveXAccountForUser(auth.userId);
  if (!activeId) return { message: "", sources: [], status: "success" };
  try {
    const sources = await listLearningSources(pooledDb, auth.userId, activeId);
    return { message: "", sources, status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function addLearningSourceAction(
  input: unknown,
): Promise<BaseResult & { jobId?: string; sourceId?: string }> {
  const parsed = addLearningSourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { sourceId, jobId, deduped } = await addLearningSource(auth.userId, parsed.data, learningDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "学習ソースを追加しました。", sourceId, status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function reimportOwnPostsAction(
  input: unknown,
): Promise<BaseResult & { jobId?: string; sourceId?: string }> {
  const parsed = reimportOwnPostsSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { sourceId, jobId, deduped } = await reimportOwnPosts(auth.userId, parsed.data, learningDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "過去投稿の再取り込みを開始しました。", sourceId, status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function removeLearningSourceAction(
  input: unknown,
): Promise<BaseResult & { jobId?: string | null }> {
  const parsed = removeLearningSourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId } = await removeLearningSource(auth.userId, parsed.data, learningDeps);
    if (jobId) after(() => dispatchJob(jobId));
    return {
      jobId,
      message: jobId ? "学習内容の削除を開始しました。" : "学習ソースを削除しました。",
      status: "success",
    };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

"use server";

import { after } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { getPool, withTransaction } from "@/lib/db/pool";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { dispatchJob } from "@/lib/jobs/dispatch";
import {
  addLearningSource,
  addLearningSourceSchema,
  listLearningSources,
  removeLearningSource,
  removeLearningSourceSchema,
  type LearningSourceDeps,
  type LearningSourceView,
} from "@/lib/learning-sources";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";
import type { Queryable } from "@/lib/x/token-refresh";

/**
 * 学習ソースCRUDの Server Actions（要件05 §8, T-M5-02）。本人のみ。zod検証・前提/所有権/冪等/限度・
 * 5件制限は中核（learning-sources.ts）で行い、ここで pool・前提収集を束ね、job作成時のみ after() で
 * worker へ dispatch する。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

const learningDeps: LearningSourceDeps = {
  runInTx: (fn) => withTransaction((client) => fn(client as unknown as Queryable)),
  gatherPrereqInputs: (userId, opts) => gatherExecutionPrereqInputs(userId, opts),
};

interface BaseResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
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

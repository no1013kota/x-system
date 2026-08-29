"use server";

import { z } from "zod";

import { after } from "next/server";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { pooledQueryable, runInPooledTx } from "@/lib/db/pool";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";
import { dispatchJob } from "@/lib/jobs/dispatch";
import {
  addLearningSource,
  addLearningSourceSchema,
  applyLearningToSettings,
  applyLearningToSettingsSchema,
  listLearningSources,
  removeLearningSource,
  removeLearningSourceSchema,
  type LearningSourceDeps,
  type LearningSourceView,
} from "@/lib/learning-sources";
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
    return errorResult(error);
  }
}

export async function addLearningSourceAction(
  input: unknown,
): Promise<BaseResult & { jobId?: string; sourceId?: string }> {
  const parsed = parseUserInput(addLearningSourceSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { sourceId, jobId, deduped } = await addLearningSource(auth.userId, parsed.data, learningDeps);
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "学習ソースを追加しました。", sourceId, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}


export async function removeLearningSourceAction(
  input: unknown,
): Promise<BaseResult & { jobId?: string | null }> {
  const parsed = parseUserInput(removeLearningSourceSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
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
    return errorResult(error);
  }
}

/**
 * **学習ソースからアカウント設定を作る／更新する**（T-M8-344・運営者の指示 2026-08-27）。
 *
 * アカウント設定が未保存でも実行できる（そのための機能）。実行中は画面が
 * 「アカウント設定を書き換え中です」と出し、完了したら新しい設定が表示される。
 */
export async function applyLearningToSettingsAction(
  input: unknown,
): Promise<BaseResult & { jobId?: string }> {
  const parsed = parseUserInput(applyLearningToSettingsSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { jobId } = await applyLearningToSettings(auth.userId, parsed.data, learningDeps);
    after(() => dispatchJob(jobId));
    return { jobId, message: "アカウント設定の書き換えを開始しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * 反映がまだ動いているか（T-M8-344）。画面が「アカウント設定を書き換え中です」を
 * いつ下ろすかを決めるために使う。**jobの中身は返さない**——画面が要るのは進行中かどうかだけ。
 */
export async function learningApplyStatusAction(
  input: unknown,
): Promise<BaseResult & { running?: boolean }> {
  const parsed = parseUserInput(z.object({ x_account_id: z.string().uuid() }), input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { rows } = await pooledDb.query<{ n: number }>(
      `select count(*)::int as n
         from generation_jobs gj join x_accounts xa on xa.id = gj.x_account_id
        where gj.x_account_id = $1 and xa.user_id = $2
          and gj.kind in ('md_merge', 'learning_analysis')
          and gj.status in ('queued', 'running')`,
      [parsed.data.x_account_id, auth.userId],
    );
    return { message: "", running: (rows[0]?.n ?? 0) > 0, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

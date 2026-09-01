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

/** 直近の反映（提案モードの md_merge）の結果（T-M8-410）。 */
export interface LearningApplyOutcome {
  status: "succeeded" | "failed";
  /** 失敗の利用者向け理由（`generation_jobs.error.message`）。 */
  message: string | null;
  finishedAt: string | null;
}

/**
 * 反映がまだ動いているか（T-M8-344）と、**直近の反映がどう終わったか**（T-M8-410）。
 * 以前は進行中かどうかだけを返していたため、jobが失敗しても画面は止まった時点で
 * 「反映しました」を出していた（運営者の報告 2026-09-01）。提案が入ったかも返す——
 * 成功トーストは提案が入ったときだけ出す。
 */
export async function learningApplyStatusAction(
  input: unknown,
): Promise<
  BaseResult & { running?: boolean; lastApply?: LearningApplyOutcome | null; proposalReady?: boolean }
> {
  const parsed = parseUserInput(z.object({ x_account_id: z.string().uuid() }), input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const [running, last, proposal] = await Promise.all([
      pooledDb.query<{ n: number }>(
        `select count(*)::int as n
           from generation_jobs gj join x_accounts xa on xa.id = gj.x_account_id
          where gj.x_account_id = $1 and xa.user_id = $2
            and gj.kind in ('md_merge', 'learning_analysis')
            and gj.status in ('queued', 'running')`,
        [parsed.data.x_account_id, auth.userId],
      ),
      // 反映＝ learning_source_id の無い md_merge（削除に伴う作り直しは含めない・mergeModeFor と同じ規則）。
      pooledDb.query<{ status: string; message: string | null; finished_at: string | null }>(
        `select gj.status::text as status, gj.error->>'message' as message, gj.finished_at
           from generation_jobs gj join x_accounts xa on xa.id = gj.x_account_id
          where gj.x_account_id = $1 and xa.user_id = $2
            and gj.kind = 'md_merge' and gj.learning_source_id is null
            and gj.status in ('succeeded', 'failed')
          order by gj.created_at desc
          limit 1`,
        [parsed.data.x_account_id, auth.userId],
      ),
      pooledDb.query<{ ready: boolean }>(
        `select settings_proposal is not null as ready from x_accounts where id = $1 and user_id = $2`,
        [parsed.data.x_account_id, auth.userId],
      ),
    ]);
    const row = last.rows[0];
    return {
      message: "",
      running: (running.rows[0]?.n ?? 0) > 0,
      lastApply: row
        ? {
            status: row.status === "succeeded" ? "succeeded" : "failed",
            message: row.message,
            finishedAt: row.finished_at,
          }
        : null,
      proposalReady: proposal.rows[0]?.ready ?? false,
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}

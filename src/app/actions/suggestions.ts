"use server";

import { after } from "next/server";

import { pooledQueryable, runInPooledTx } from "@/lib/db/pool";
import { dispatchJob } from "@/lib/jobs/dispatch";
import {
  listSuggestions,
  refreshSuggestions,
  refreshSuggestionsSchema,
  type SuggestionView,
} from "@/lib/jobs/suggestion-jobs";
import { AppError } from "@/lib/observability/errors";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { errorResult, requireUserId, type BaseResult } from "./_helpers";

/**
 * 改善提案の Server Actions（SUGGEST, K-2, 要件05 §9, T-M5-18）。本人のactive Xアカウントのみ。
 * refreshSuggestions は request_key 冪等・各ガード（中核 suggestion-jobs.ts）を通し、作成時のみ after() で
 * worker へ dispatch する。listSuggestions は最新の成功 suggestion job の提案を返す。提案は表示専用。
 */

const pooledDb = pooledQueryable();

async function requireActive(): Promise<
  { ok: true; userId: string; xAccountId: string } | { ok: false; result: BaseResult }
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth;
  const xAccountId = await resolveActiveXAccountForUser(auth.userId);
  if (!xAccountId) {
    return { ok: false, result: errorResult(new AppError("not_found")) };
  }
  return { ok: true, userId: auth.userId, xAccountId };
}

export async function refreshSuggestionsAction(
  input: unknown,
): Promise<BaseResult & { jobId?: string }> {
  const parsed = refreshSuggestionsSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
  }
  const auth = await requireActive();
  if (!auth.ok) return auth.result;
  try {
    const { jobId, deduped } = await refreshSuggestions(auth.userId, auth.xAccountId, parsed.data, {
      runInTx: runInPooledTx,
    });
    if (!deduped) after(() => dispatchJob(jobId));
    return { jobId, message: "改善提案を更新しています。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function listSuggestionsAction(): Promise<
  BaseResult & { suggestions?: SuggestionView[] }
> {
  const auth = await requireActive();
  if (!auth.ok) return auth.result;
  try {
    const suggestions = await listSuggestions(pooledDb, auth.userId, auth.xAccountId);
    return { message: "", status: "success", suggestions };
  } catch (error) {
    return errorResult(error);
  }
}

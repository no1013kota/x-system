"use server";

import { after } from "next/server";

import { runInPooledTx } from "@/lib/db/pool";
import { dispatchJob } from "@/lib/jobs/dispatch";
import { refreshSuggestions, refreshSuggestionsSchema } from "@/lib/jobs/suggestion-jobs";
import { AppError } from "@/lib/observability/errors";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";

/**
 * 改善提案の Server Action（SUGGEST, K-2, 要件05 §9, T-M5-18）。本人のactive Xアカウントのみ。
 * refreshSuggestions は request_key 冪等・各ガード（中核 suggestion-jobs.ts）を通し、作成時のみ after() で
 * worker へ dispatch する。**提案の一覧は Server Component（analytics-server.ts の
 * loadSuggestionsForUser）が読む**（読み取りだけに外から叩けるPOST受け口を作らない・F12）。提案は表示専用。
 */

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
  const parsed = parseUserInput(refreshSuggestionsSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
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


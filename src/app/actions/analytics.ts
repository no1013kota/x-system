"use server";

import { z } from "zod";

import type { AnalyticsSummary } from "@/lib/analytics";
import { getAnalyticsSummaryForUser } from "@/lib/analytics-server";
import { getCurrentUser } from "@/lib/auth/session";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

/**
 * 投稿実績集計の Server Action（SC-09, 要件05 §9, T-M5-15）。本人のactive Xアカウントの tweet_metrics を
 * 期間（period_days）で集計して返す。合算は表示時計算で別カラム保存しない。
 */

interface BaseResult {
  code?: string;
  message: string;
  status: "error" | "success";
}

const schema = z.object({ period_days: z.number().int().min(1).max(365) });

export async function getAnalyticsSummaryAction(
  input: unknown,
): Promise<BaseResult & { summary?: AnalyticsSummary }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ...toUserFacingError(new AppError("unauthorized")), status: "error" };
  }
  try {
    const xAccountId = await resolveActiveXAccountForUser(user.id);
    if (!xAccountId) {
      return { ...toUserFacingError(new AppError("not_found")), status: "error" };
    }
    const summary = await getAnalyticsSummaryForUser(user.id, xAccountId, parsed.data.period_days);
    return { message: "", status: "success", summary };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

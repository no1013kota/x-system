"use server";

import { z } from "zod";

import type { AnalyticsSummary } from "@/lib/analytics";
import { getAnalyticsSummaryForUser } from "@/lib/analytics-server";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResult } from "./_helpers";
import { AppError } from "@/lib/observability/errors";
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
    return errorResult(new AppError("validation_error"));
  }
  const user = await getCurrentUser();
  if (!user) {
    return errorResult(new AppError("unauthorized"));
  }
  try {
    const xAccountId = await resolveActiveXAccountForUser(user.id);
    if (!xAccountId) {
      return errorResult(new AppError("not_found"));
    }
    const summary = await getAnalyticsSummaryForUser(user.id, xAccountId, parsed.data.period_days);
    return { message: "", status: "success", summary };
  } catch (error) {
    return errorResult(error);
  }
}

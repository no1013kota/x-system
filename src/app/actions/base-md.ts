"use server";

import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import {
  getBaseMdForUser,
  isLearningRunningForUser,
  listBaseMdVersionsForUser,
  rollbackBaseMdForUser,
  updateBaseMdManualForUser,
} from "@/lib/base-md-server";
import type { BaseMdVersionView } from "@/lib/base-md";
import { AppError, toUserFacingError } from "@/lib/observability/errors";

/**
 * ベースmd手動編集・履歴・ロールバックの Server Actions（M-1, 要件05 §8/§9）。本人のみ。プラン制限
 * （standard forbidden）・6見出し/5,000字検証・楽観lock・learning running 拒否は中核（base-md.ts）で行う。
 */

interface BaseResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
}

const xAccountSchema = z.object({ x_account_id: z.string().uuid() });
const updateSchema = z.object({
  x_account_id: z.string().uuid(),
  content: z.string(),
  expected_version: z.number().int().min(0),
});
const rollbackSchema = z.object({
  x_account_id: z.string().uuid(),
  version: z.number().int().min(1),
  expected_version: z.number().int().min(0),
});

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

export async function getBaseMdAction(
  input: unknown,
): Promise<
  BaseResult & { content?: string; version?: number; history?: BaseMdVersionView[]; learningRunning?: boolean }
> {
  const parsed = xAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const [base, history, learningRunning] = await Promise.all([
      getBaseMdForUser(auth.userId, parsed.data.x_account_id),
      listBaseMdVersionsForUser(auth.userId, parsed.data.x_account_id),
      isLearningRunningForUser(auth.userId, parsed.data.x_account_id),
    ]);
    return { content: base.content, history, learningRunning, message: "", status: "success", version: base.version };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function updateBaseMdManualAction(
  input: unknown,
): Promise<BaseResult & { version?: number }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { version } = await updateBaseMdManualForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      content: parsed.data.content,
      expectedVersion: parsed.data.expected_version,
    });
    return { message: "ベースmdを保存しました。", status: "success", version };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function rollbackBaseMdAction(
  input: unknown,
): Promise<BaseResult & { version?: number }> {
  const parsed = rollbackSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { version } = await rollbackBaseMdForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      targetVersion: parsed.data.version,
      expectedVersion: parsed.data.expected_version,
    });
    return { message: "指定のバージョンへロールバックしました。", status: "success", version };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

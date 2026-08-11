"use server";

import { z } from "zod";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import {
  getBaseMdForUser,
  isLearningRunningForUser,
  listBaseMdVersionsForUser,
  rollbackBaseMdForUser,
  updateBaseMdManualForUser,
} from "@/lib/base-md-server";
import type { BaseMdVersionView } from "@/lib/base-md";

/**
 * ベースmd手動編集・履歴・ロールバックの Server Actions（M-1, 要件05 §8/§9）。本人のみ。プラン制限
 * （standard forbidden）・6見出し/5,000字検証・楽観lock・learning running 拒否は中核（base-md.ts）で行う。
 */

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

export async function getBaseMdAction(
  input: unknown,
): Promise<
  BaseResult & { content?: string; version?: number; history?: BaseMdVersionView[]; learningRunning?: boolean }
> {
  const parsed = parseUserInput(xAccountSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
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
    return errorResult(error);
  }
}

export async function updateBaseMdManualAction(
  input: unknown,
): Promise<BaseResult & { version?: number }> {
  const parsed = parseUserInput(updateSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
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
    return errorResult(error);
  }
}

export async function rollbackBaseMdAction(
  input: unknown,
): Promise<BaseResult & { version?: number }> {
  const parsed = parseUserInput(rollbackSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
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
    return errorResult(error);
  }
}

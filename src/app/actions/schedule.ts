"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { type BaseResult, errorResult, requireExecutionUserId, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { pooledQueryable, runInPooledTx } from "@/lib/db/pool";
import {
  disableXAutomation,
  recordXAutomationConsent,
  recordXAutomationConsentSchema,
  type AutomationConsentState,
  type DisableAutomationResult,
} from "@/lib/x/automation-consent";
import {
  createScheduleSlot,
  createScheduleSlotSchema,
  deleteScheduleSlot,
  disableScheduleSlot,
  enableScheduleSlot,
  listScheduleSlots,
  slotLockSchema,
  updateScheduleSlot,
  updateScheduleSlotSchema,
  type ScheduleSlotDeps,
  type ScheduleSlotView,
} from "@/lib/schedule-slots";
import { resolveActiveXAccountForUser } from "@/lib/x/account-actions-server";

/**
 * スケジュールスロットの Server Actions（要件05 §7, T-M4-01）。本人のみ・active_x_account スコープ。
 * zod検証・楽観lock・auto同意ゲートは中核（schedule-slots.ts）で行い、ここで pool・active_x_account
 * 解決・revalidate を束ねる。
 */

const pooledDb = pooledQueryable();

const slotDeps: ScheduleSlotDeps = {
  runInTx: runInPooledTx,
  resolveActiveXAccountId: (userId) => resolveActiveXAccountForUser(userId),
};

export async function listScheduleSlotsAction(): Promise<
  BaseResult & { slots?: ScheduleSlotView[] }
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const activeId = await resolveActiveXAccountForUser(auth.userId);
    const slots = activeId ? await listScheduleSlots(pooledDb, activeId) : [];
    return { slots, message: "", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function createScheduleSlotAction(
  input: unknown,
): Promise<BaseResult & { slot?: ScheduleSlotView }> {
  const parsed = parseUserInput(createScheduleSlotSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const slot = await createScheduleSlot(auth.userId, parsed.data, slotDeps);
    revalidatePath("/app/schedule");
    return { message: "スケジュールを作成しました。", slot, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function updateScheduleSlotAction(
  input: unknown,
): Promise<BaseResult & { slot?: ScheduleSlotView }> {
  const parsed = parseUserInput(updateScheduleSlotSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const slot = await updateScheduleSlot(auth.userId, parsed.data, slotDeps);
    revalidatePath("/app/schedule");
    return { message: "スケジュールを更新しました。", slot, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function disableScheduleSlotAction(
  input: unknown,
): Promise<BaseResult & { slot?: ScheduleSlotView }> {
  const parsed = parseUserInput(slotLockSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const slot = await disableScheduleSlot(auth.userId, parsed.data, slotDeps);
    revalidatePath("/app/schedule");
    return { message: "スケジュールを停止しました。", slot, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

/** 停止したスロットの再開（要件05 §7）。auto は中核側で同意ゲートを通す。 */
export async function enableScheduleSlotAction(
  input: unknown,
): Promise<BaseResult & { slot?: ScheduleSlotView }> {
  const parsed = parseUserInput(slotLockSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const slot = await enableScheduleSlot(auth.userId, parsed.data, slotDeps);
    revalidatePath("/app/schedule");
    return { message: "スケジュールを再開しました。", slot, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

const disableAutomationSchema = z.object({ x_account_id: z.string().uuid() });

export async function recordXAutomationConsentAction(
  input: unknown,
): Promise<BaseResult & { consent?: AutomationConsentState }> {
  const parsed = parseUserInput(recordXAutomationConsentSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;
  try {
    const consent = await recordXAutomationConsent(pooledDb, auth.userId, parsed.data);
    revalidatePath("/app/schedule");
    return { consent, message: "自動投稿への同意を記録しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function disableXAutomationAction(
  input: unknown,
): Promise<BaseResult & { result?: DisableAutomationResult }> {
  const parsed = parseUserInput(disableAutomationSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const result = await disableXAutomation(auth.userId, parsed.data.x_account_id, {
      runInTx: runInPooledTx,
    });
    revalidatePath("/app/schedule");
    return { message: "自動投稿を停止しました。", result, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function deleteScheduleSlotAction(input: unknown): Promise<BaseResult> {
  const parsed = parseUserInput(slotLockSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await deleteScheduleSlot(auth.userId, parsed.data, slotDeps);
    revalidatePath("/app/schedule");
    return { message: "スケジュールを削除しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

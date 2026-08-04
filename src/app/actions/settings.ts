"use server";

import { revalidatePath } from "next/cache";

import { errorResult, requireUserId, type BaseResult } from "./_helpers";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import {
  newsConfigSchema,
  notificationConfigSchema,
} from "@/lib/settings";
import {
  saveNewsConfigForUser,
  saveNotificationConfigForUser,
} from "@/lib/settings-server";

/**
 * 通知・ニュース設定の Server Actions（要件05 §4.1）。本人のみ。zodで検証し保存する。
 * 表示名（プロフィール）は T-M8-59 で削除した（どこにも使われていなかった）。
 */

export async function updateNotificationConfigAction(
  input: unknown,
): Promise<BaseResult> {
  const parsed = notificationConfigSchema.safeParse(input);
  if (!parsed.success) {
    return errorResult(new AppError("validation_error"));
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await saveNotificationConfigForUser(auth.userId, parsed.data);
    revalidatePath("/app/settings");
    return { message: "通知設定を保存しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function updateNewsConfigAction(input: unknown): Promise<BaseResult> {
  const parsed = newsConfigSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    return {
      ...toUserFacingError(
        new AppError("validation_error", first ? { message: first } : undefined),
      ),
      status: "error",
    };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await saveNewsConfigForUser(auth.userId, parsed.data);
    revalidatePath("/app/settings");
    revalidatePath("/app/news");
    return { message: "ニュース設定を保存しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

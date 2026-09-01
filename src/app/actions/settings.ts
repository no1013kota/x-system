"use server";

import { revalidatePath } from "next/cache";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import {
  newsConfigSchema,
  newsEmailNotificationSchema,
  notificationConfigSchema,
} from "@/lib/settings";
import {
  saveNewsConfigForUser,
  saveNewsEmailNotificationForUser,
  saveNotificationConfigForUser,
} from "@/lib/settings-server";

/**
 * 通知・ニュース設定の Server Actions（要件05 §4.1）。本人のみ。zodで検証し保存する。
 * 表示名（プロフィール）は T-M8-59 で削除した（どこにも使われていなかった）。
 */

export async function updateNotificationConfigAction(
  input: unknown,
): Promise<BaseResult> {
  const parsed = parseUserInput(notificationConfigSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
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
  const parsed = parseUserInput(newsConfigSchema, input);
  if (!parsed.success) {
    // NOTE: `toUserFacingError` は `USER_MESSAGES[code]` を返し AppError の message を見ないため、
    // zod の先頭メッセージを渡しても画面には出ない（＝計算するだけで捨てられていた・R26）。
    // 具体的な理由を出すかは振る舞い変更なので要決定 D-26 で扱う。
    return validationErrorResult(parsed.error);
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

/**
 * ニュースのメール通知（ON/OFF）だけを保存する（T-M8-407・運営者の指示 2026-09-01）。
 * 設定＞通知の「ニュース通知」カードから、テーマ・インパクトと一緒に押される。
 * 他の種別・アプリ内通知の値は触らない（画面ごとの保存が互いを上書きしないため）。
 */
export async function updateNewsEmailNotificationAction(input: unknown): Promise<BaseResult> {
  const parsed = parseUserInput(newsEmailNotificationSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await saveNewsEmailNotificationForUser(auth.userId, parsed.data.email);
    revalidatePath("/app/settings");
    return { message: "ニュースのメール通知を保存しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

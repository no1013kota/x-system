"use server";

import { z } from "zod";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
  markAllNotificationsReadForUser,
  markNotificationReadForUser,
  retryNotificationEmailForUser,
} from "@/lib/notifications-server";
import type {
  NotificationListPayload,
  NotificationMutationPayload,
} from "@/lib/notifications";

/**
 * アプリ内通知の Server Actions（要件05 §10）。本人のみ。閲覧・既読化を提供し、既読系は最新の
 * 未読件数を返してベルのバッジを即時更新できるようにする。
 */

/**
 * payloadの形は `@/lib/notifications` を正本にする（T-M8-158）。ここへ列挙を書き戻すと、
 * propsでAction契約を受け取るヘッダ通知ベルとの二重定義が復活し、改名が型検査を抜ける。
 */
export interface ListNotificationsActionResult
  extends BaseResult,
    NotificationListPayload {}

export interface NotificationMutationResult
  extends BaseResult,
    NotificationMutationPayload {}

const listSchema = z.object({
  cursor: z.string().optional(),
  unread_only: z.boolean().optional(),
});
const idSchema = z.object({ notification_id: z.string().uuid() });

export async function listNotificationsAction(
  input: unknown = {},
): Promise<ListNotificationsActionResult> {
  const parsed = parseUserInput(listSchema, input ?? {});
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const [page, unreadCount] = await Promise.all([
      listNotificationsForUser(auth.userId, {
        cursor: parsed.data.cursor,
        unreadOnly: parsed.data.unread_only,
      }),
      countUnreadNotificationsForUser(auth.userId),
    ]);
    return {
      items: page.items,
      message: "",
      nextCursor: page.nextCursor,
      status: "success",
      unreadCount,
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function markNotificationReadAction(
  input: unknown,
): Promise<NotificationMutationResult> {
  const parsed = parseUserInput(idSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await markNotificationReadForUser(auth.userId, parsed.data.notification_id);
    const unreadCount = await countUnreadNotificationsForUser(auth.userId);
    return { message: "", status: "success", unreadCount };
  } catch (error) {
    return errorResult(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationMutationResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const count = await markAllNotificationsReadForUser(auth.userId);
    return { count, message: "", status: "success", unreadCount: 0 };
  } catch (error) {
    return errorResult(error);
  }
}

export async function retryNotificationEmailAction(
  input: unknown,
): Promise<BaseResult> {
  const parsed = parseUserInput(idSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await retryNotificationEmailForUser(auth.userId, parsed.data.notification_id);
    return { message: "メールの再送を予約しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

"use server";

import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
  markAllNotificationsReadForUser,
  markNotificationReadForUser,
  retryNotificationEmailForUser,
} from "@/lib/notifications-server";
import type { NotificationView } from "@/lib/notifications";

/**
 * アプリ内通知の Server Actions（要件05 §10）。本人のみ。閲覧・既読化を提供し、既読系は最新の
 * 未読件数を返してベルのバッジを即時更新できるようにする。
 */

interface BaseResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
}

export interface ListNotificationsActionResult extends BaseResult {
  items?: NotificationView[];
  nextCursor?: string | null;
  unreadCount?: number;
}

export interface NotificationMutationResult extends BaseResult {
  unreadCount?: number;
  count?: number;
}

const listSchema = z.object({
  cursor: z.string().optional(),
  unread_only: z.boolean().optional(),
});
const idSchema = z.object({ notification_id: z.string().uuid() });

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

export async function listNotificationsAction(
  input: unknown = {},
): Promise<ListNotificationsActionResult> {
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
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
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function markNotificationReadAction(
  input: unknown,
): Promise<NotificationMutationResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await markNotificationReadForUser(auth.userId, parsed.data.notification_id);
    const unreadCount = await countUnreadNotificationsForUser(auth.userId);
    return { message: "", status: "success", unreadCount };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationMutationResult> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const count = await markAllNotificationsReadForUser(auth.userId);
    return { count, message: "", status: "success", unreadCount: 0 };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

export async function retryNotificationEmailAction(
  input: unknown,
): Promise<BaseResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) {
    return { ...toUserFacingError(new AppError("validation_error")), status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    await retryNotificationEmailForUser(auth.userId, parsed.data.notification_id);
    return { message: "メールの再送を予約しました。", status: "success" };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

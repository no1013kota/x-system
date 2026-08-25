import "server-only";

import { pooledQueryable } from "./db/pool";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationPage,
} from "./notifications";

/**
 * アプリ内通知の server-only 配線（要件05 §10）。pool を束ねて純粋層（`notifications.ts`）を実値で使う。
 */

const pooledDb = pooledQueryable();

export function listNotificationsForUser(
  userId: string,
  options: { cursor?: string | null; unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationPage> {
  return listNotifications(pooledDb, userId, options);
}

export function countUnreadNotificationsForUser(userId: string): Promise<number> {
  return countUnreadNotifications(pooledDb, userId);
}

export function markNotificationReadForUser(
  userId: string,
  notificationId: string,
): Promise<{ id: string; readAt: string }> {
  return markNotificationRead(pooledDb, userId, notificationId);
}

export function markAllNotificationsReadForUser(userId: string): Promise<number> {
  return markAllNotificationsRead(pooledDb, userId);
}


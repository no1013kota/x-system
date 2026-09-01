import "server-only";

import { pooledQueryable } from "./db/pool";
import {
  readSettings,
  saveNewsConfig,
  saveNewsEmailNotification,
  saveNotificationConfig,
  type NewsConfig,
  type NotificationConfigInput,
  type UserSettings,
} from "./settings";

/**
 * プロフィール・通知・ニュース設定の server-only 配線（要件05 §4.1）。pool を束ねて純粋層を実値で使う。
 */

const pooledDb = pooledQueryable();

export function getSettingsForUser(userId: string): Promise<UserSettings | null> {
  return readSettings(pooledDb, userId);
}


export function saveNotificationConfigForUser(
  userId: string,
  config: NotificationConfigInput,
): Promise<void> {
  return saveNotificationConfig(pooledDb, userId, config);
}

/** ニュースのメール通知だけを切り替える（T-M8-407）。 */
export function saveNewsEmailNotificationForUser(userId: string, email: boolean): Promise<void> {
  return saveNewsEmailNotification(pooledDb, userId, email);
}

export function saveNewsConfigForUser(
  userId: string,
  config: NewsConfig,
): Promise<void> {
  return saveNewsConfig(pooledDb, userId, config);
}

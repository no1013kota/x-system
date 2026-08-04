import "server-only";

import { pooledQueryable } from "./db/pool";
import {
  readSettings,
  saveNewsConfig,
  saveNotificationConfig,
  type NewsConfig,
  type NotificationConfig,
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
  config: NotificationConfig,
): Promise<void> {
  return saveNotificationConfig(pooledDb, userId, config);
}

export function saveNewsConfigForUser(
  userId: string,
  config: NewsConfig,
): Promise<void> {
  return saveNewsConfig(pooledDb, userId, config);
}

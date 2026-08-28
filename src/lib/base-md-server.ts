import "server-only";

import { withTransaction, pooledQueryable } from "./db/pool";
import {
  applyRollbackBaseMd,
  isLearningRunning,
  listBaseMdVersions,
  type BaseMdVersionView,
  type BaseMdWriteResult,
} from "./base-md";

/** アカウント.md手動編集の server-only 配線（M-1, T-M5-08）。書き込みは withTransaction で束ねる。 */

const pooledDb = pooledQueryable();


export function rollbackBaseMdForUser(input: {
  userId: string;
  xAccountId: string;
  targetVersion: number;
  expectedVersion: number;
}): Promise<BaseMdWriteResult> {
  return withTransaction((client) => applyRollbackBaseMd(client, input));
}


export function listBaseMdVersionsForUser(
  userId: string,
  xAccountId: string,
): Promise<BaseMdVersionView[]> {
  return listBaseMdVersions(pooledDb, userId, xAccountId);
}

export function isLearningRunningForUser(userId: string, xAccountId: string): Promise<boolean> {
  return isLearningRunning(pooledDb, userId, xAccountId);
}

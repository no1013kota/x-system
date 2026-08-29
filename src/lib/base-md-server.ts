import "server-only";

import { pooledQueryable } from "./db/pool";
import { isLearningRunning } from "./base-md";

/**
 * アカウント.mdの server-only 配線。
 *
 * **変更履歴とロールバックは廃止した**（T-M8-362・運営者の指示 2026-08-29）。
 * 版を戻す代わりに、プロンプト画面の本棚（`prompt_presets`）で**別の本文を持って選ぶ**。
 * 自動で版が積み上がる仕組みが無くなったので、保持上限（旧 `BASE_MD_HISTORY_LIMIT`）も要らない。
 */

const pooledDb = pooledQueryable();

export function isLearningRunningForUser(userId: string, xAccountId: string): Promise<boolean> {
  return isLearningRunning(pooledDb, userId, xAccountId);
}

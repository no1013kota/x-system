import "server-only";

import { getPool } from "../db/pool";
import { buildXReadDeps } from "../x/read-client-server";
import { readUserFollowers } from "../x/read-client";
import { getValidXAccessToken } from "../x/token-refresh-server";
import type { Queryable } from "../x/token-refresh";
import { createDeadline } from "./deadline";
import {
  executeFollowerSnapshot,
  type FollowerSnapshotResult,
} from "./follower-snapshot";

/**
 * follower_snapshot の server-only 配線（K-3, 要件04 §6/§13, T-M5-14）。pool・token復号/refresh・X user読取・
 * Function deadline を束ねて中核へ渡す。token取得不能や読取失敗はaccount単位で隔離し次窓へ委ねる。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

export async function runFollowerSnapshot(windowKey: string): Promise<FollowerSnapshotResult> {
  const deadline = createDeadline();
  return executeFollowerSnapshot({
    db: pooledDb,
    isPastDeadline: () => !deadline.canStartCall(),
    onError: (scope, err) => console.error(`[follower_snapshot] ${scope.xAccountId}`, err),
    getAccessToken: async (xAccountId) => {
      try {
        return await getValidXAccessToken(xAccountId);
      } catch {
        return null; // 失効・refresh不能は次窓で再走査
      }
    },
    readFollowersCount: async ({ xAccountId, userId, xUserId, accessToken }) => {
      const deps = buildXReadDeps(accessToken, { userId, xAccountId, jobId: null });
      // 原価台帳の idempotencyKey は時間窓を含める（各アカウントは当日1回のみ読むが、窓ごとの
      // 再試行を別計上するため。同窓内の重複だけ dedup する）。
      const { users } = await readUserFollowers(deps, {
        userIds: [xUserId],
        idempotencyKey: `follower:${windowKey}:${xAccountId}`,
      });
      return users[0]?.followersCount ?? null;
    },
  });
}

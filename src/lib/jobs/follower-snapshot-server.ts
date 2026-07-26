import "server-only";

import { pooledQueryable } from "../db/pool";
import { buildXReadDeps } from "../x/read-client-server";
import { readUserFollowers } from "../x/read-client";
import { getValidXAccessToken } from "../x/token-refresh-server";
import { createDeadline } from "./deadline";
import { recordUnexpectedError } from "../observability/sentry";
import {
  executeFollowerSnapshot,
  type FollowerSnapshotResult,
} from "./follower-snapshot";

/**
 * follower_snapshot の server-only 配線（K-3, 要件04 §6/§13, T-M5-14）。pool・token復号/refresh・X user読取・
 * Function deadline を束ねて中核へ渡す。token取得不能や読取失敗はaccount単位で隔離し次窓へ委ねる。
 */

const pooledDb = pooledQueryable();

export async function runFollowerSnapshot(windowKey: string): Promise<FollowerSnapshotResult> {
  const deadline = createDeadline();
  return executeFollowerSnapshot({
    db: pooledDb,
    isPastDeadline: () => !deadline.canStartCall(),
    onError: (scope, err) => console.error(`[follower_snapshot] ${scope.xAccountId}`, err),
    getAccessToken: async (xAccountId) => {
      try {
        return await getValidXAccessToken(xAccountId);
      } catch (error) {
        // null は「次窓で再走査」を意味する。token失効とDB権限漏れが区別できず、後者は
        // 永久に持ち越されるため記録する（中核側のログ経路をこのcatchが潰していた）。
        recordUnexpectedError(error, { at: "follower-snapshot:token", xAccountId });
        return null;
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

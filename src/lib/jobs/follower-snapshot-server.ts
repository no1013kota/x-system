import "server-only";

import { pooledQueryable } from "../db/pool";
import { buildXReadDeps } from "../x/read-client-server";
import { readUserFollowers } from "../x/read-client";
import { getValidXAccessToken } from "../x/token-refresh-server";
import { createDeadline } from "./deadline";
import { recordUnexpectedError } from "../observability/sentry";
import { executeFollowerSnapshot, type FollowerSnapshotResult } from "./follower-snapshot";

/**
 * フォロワー数記録の server-only 配線（K-3, 要件04 §6/§13, T-M5-14→T-M8-257）。
 * pool・token復号/refresh・X user読取・Function deadline を束ねて中核へ渡す。
 * 入口は毎時cron（`runFollowerSnapshot`）の1つだけ（「分析を開始」からの記録はT-M8-403で廃止）。
 */

const pooledDb = pooledQueryable();

function getAccessTokenSafely(at: string) {
  return async (xAccountId: string): Promise<string | null> => {
    try {
      return await getValidXAccessToken(xAccountId);
    } catch (error) {
      // null は「次窓で再走査」を意味する。token失効とDB権限漏れが区別できず、後者は
      // 永久に持ち越されるため記録する（T-M8-239と同じ理由）。
      recordUnexpectedError(error, { at, xAccountId });
      return null;
    }
  };
}

export async function runFollowerSnapshot(windowKey: string): Promise<FollowerSnapshotResult> {
  const deadline = createDeadline();
  return executeFollowerSnapshot({
    db: pooledDb,
    isPastDeadline: () => !deadline.canStartCall(),
    // 中核が用意した記録口。console だけだと運営者に届かない（T-M8-239・原則2）。
    onError: (scope, err) =>
      recordUnexpectedError(err, { at: "follower-snapshot", xAccountId: scope.xAccountId }),
    getAccessToken: getAccessTokenSafely("follower-snapshot:token"),
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

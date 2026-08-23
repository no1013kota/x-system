import "server-only";

import { pooledQueryable } from "../db/pool";
import { buildXReadDeps } from "../x/read-client-server";
import { readUserFollowers } from "../x/read-client";
import { getValidXAccessToken } from "../x/token-refresh-server";
import { recordUnexpectedError } from "../observability/sentry";
import {
  snapshotFollowerToday,
  type SnapshotFollowerOutcome,
} from "./follower-snapshot";

/**
 * フォロワー数記録の server-only 配線（K-3, T-M8-255）。「分析を開始」ボタンの Server Action から
 * 呼ばれ、操作中アカウントの当日分を1件記録する。pool・token復号/refresh・X user読取を束ねて中核へ渡す。
 */

const pooledDb = pooledQueryable();

export async function snapshotFollowerTodayForAccount(
  xAccountId: string,
  userId: string,
): Promise<SnapshotFollowerOutcome | { written: false; reason: "not_found" }> {
  const { rows } = await pooledDb.query<{ x_user_id: string }>(
    `select x_user_id from x_accounts where id = $1 and user_id = $2 and status = 'active'`,
    [xAccountId, userId],
  );
  if (!rows[0]) return { written: false, reason: "not_found" };
  const xUserId = rows[0].x_user_id;

  return snapshotFollowerToday(
    {
      db: pooledDb,
      getAccessToken: async (id) => {
        try {
          return await getValidXAccessToken(id);
        } catch (error) {
          // token失効とDB権限漏れが区別できないため記録する（T-M8-239と同じ理由）。
          recordUnexpectedError(error, { at: "follower-snapshot:token", xAccountId: id });
          return null;
        }
      },
      readFollowersCount: async ({ xAccountId: id, userId: uid, xUserId: xuid, accessToken }) => {
        const deps = buildXReadDeps(accessToken, { userId: uid, xAccountId: id, jobId: null });
        // 原価台帳の冪等キーはJST日付単位（同日中の再押下は読み直すが台帳はdedup）。
        const day = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
        const { users } = await readUserFollowers(deps, {
          userIds: [xuid],
          idempotencyKey: `follower:manual:${day}:${id}`,
        });
        return users[0]?.followersCount ?? null;
      },
    },
    { xAccountId, userId, xUserId },
  );
}

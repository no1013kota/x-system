import "server-only";

import { pooledQueryable } from "../db/pool";
import { startOfWeekJstIso } from "./kpi";

/**
 * ホームKPIのうち、DBから取るもの（T-M8-05）。判定は `kpi.ts`（純関数）側。
 *
 * **所有権を必ずクエリで絞る**（`xa.user_id = $2`）。画面から渡ってきた xAccountId を
 * そのまま信用しない（他の利用者の数字が出ると分離が壊れる）。
 */

const db = pooledQueryable();

/** 今週（JST月曜起点）に投稿した件数と、そのうち自動投稿の件数。 */
export async function loadPostsThisWeek(
  userId: string,
  xAccountId: string,
  now: Date = new Date(),
): Promise<{ total: number; auto: number }> {
  const { rows } = await db.query<{ total: string; auto: string }>(
    `select count(*)::text as total,
            count(*) filter (where d.posted_mode = 'auto')::text as auto
       from drafts d
       join x_accounts xa on xa.id = d.x_account_id
      where d.x_account_id = $1 and xa.user_id = $2
        and d.posted_at is not null and d.posted_at >= $3::timestamptz`,
    [xAccountId, userId, startOfWeekJstIso(now)],
  );
  return { total: Number(rows[0]?.total ?? 0), auto: Number(rows[0]?.auto ?? 0) };
}

import "server-only";

import { pooledQueryable } from "../db/pool";
import type { Queryable } from "../x/token-refresh";

/**
 * 当日（JST）にそのXアカウントが投稿したポスト数（T-M8-26）。
 *
 * **SQLをここ1か所に置く。** 以前は投稿job（`jobs/post-publish.ts`）の中に同じ問い合わせが
 * 埋まっていた。画面のバナーが別のSQLで数えると、境界（JSTの日付の変わり目・数える operation）が
 * ずれて「バナーは出ないのに投稿は弾かれる」状態になり得る。
 *
 * 数えるのは `operation = 'post_create'` だけ。削除（`post_delete`）や生成は当日の投稿数に
 * 含めない（Xへ出た本数を数えたいため）。`post_create` は `usage_events_post_op` 制約により
 * `reason = 'consume'` に限られるので、その条件は念のためのもの。
 *
 * インデックスは張っていない。`usage_events` は日次上限（既定50件/日）と40日の保持期間で
 * 上限が決まるため数千行に収まり、**画面表示ごとの全走査でも問題にならない**。
 * 保持期間や上限を大きく変えるときは `(x_account_id, created_at)` を見直す。
 */
export async function countTodaysPostsForXAccount(
  db: Queryable,
  xAccountId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from usage_events
      where x_account_id = $1 and operation = 'post_create' and reason = 'consume'
        and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date`,
    [xAccountId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * 画面（App Shell）から呼ぶ版。プール接続を自前で用意する
 * （`usage-summary-server.ts` と同じ形。呼び出し側にDBの扱いを持ち込まない）。
 */
export async function loadTodaysPostCount(xAccountId: string): Promise<number> {
  return countTodaysPostsForXAccount(pooledQueryable(), xAccountId);
}

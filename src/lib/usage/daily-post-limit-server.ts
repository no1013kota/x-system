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
 * **索引と述語の形は変えない**（T-M8-287）。ここは `/app` の全描画・予約枠のenqueue・投稿実行の
 * 3経路から呼ばれる。以前は索引が無く、述語も `(created_at at time zone 'Asia/Tokyo')::date = …`
 * で索引が効かない形だったため、**毎描画で `usage_events` を全走査**していた。当時のコメントは
 * 「日次上限と40日の保持期間で数千行に収まる」と正当化していたが、**`usage_events` に保持期間は
 * 無い**（cleanupが消すのは `external_api_usage_events`。こちらは原価・利用枠の台帳として永続する）。
 * 利用者が増えるほど遅くなる形だった。
 *
 * いまは部分索引 `usage_events_account_post_created_idx (x_account_id, created_at desc)
 * where operation = 'post_create'` があり、下の**範囲比較**がそれに乗る。日付関数で包むと
 * 索引が使えなくなるので戻さないこと。
 */
export async function countTodaysPostsForXAccount(
  db: Queryable,
  xAccountId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    // JSTの当日 [今日の0:00, 明日の0:00) を timestamptz の範囲で表す（索引が効く形）。
    `select count(*)::int as n from usage_events
      where x_account_id = $1 and operation = 'post_create' and reason = 'consume'
        and created_at >= (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
        and created_at <  ((date_trunc('day', now() at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo')`,
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

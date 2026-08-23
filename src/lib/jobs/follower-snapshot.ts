import type { Queryable } from "../x/token-refresh";

/**
 * フォロワー数の記録（K-3, 要件02 §3.11, T-M5-14→T-M8-255）。
 *
 * 2026-08-23 の刷新で**毎時の定時収集（follower_snapshot cron）を廃止**し、投稿分析画面の
 * 「分析を開始」ボタンが**そのとき（JST当日分）の値を1件記録する**形にした（運営者の指示。
 * 定時収集はアカウント数×毎日のX読取費用が利用の有無に関わらず積み上がるため）。
 *
 * **過去日の遡り記録はできない**——X API はフォロワー数の履歴を提供せず、取れるのは現在値だけ。
 * ボタンを押さなかった日はグラフ上の欠測になる（偽の値で埋めない・原則1）。
 * DB・X読取は注入し純粋に保つ。
 */

export interface SnapshotFollowerDeps {
  db: Queryable;
  /** 対象アカウントの有効access token（token復号/refresh）。取得不能なら null。 */
  getAccessToken: (xAccountId: string) => Promise<string | null>;
  /** 自アカウントの followers_count を user token で読む（取得不能は null）。 */
  readFollowersCount: (input: {
    xAccountId: string;
    userId: string;
    xUserId: string;
    accessToken: string;
  }) => Promise<number | null>;
}

export type SnapshotFollowerOutcome =
  | { written: true; followersCount: number }
  | { written: false; reason: "token_unavailable" | "count_unavailable" };

/**
 * 対象アカウントのフォロワー数を読み、JST当日分として upsert する（同日再実行は上書き）。
 * token・読取の失敗は理由つきで返す（黙って0件にしない・原則1）。
 */
export async function snapshotFollowerToday(
  deps: SnapshotFollowerDeps,
  acct: { xAccountId: string; userId: string; xUserId: string },
): Promise<SnapshotFollowerOutcome> {
  const token = await deps.getAccessToken(acct.xAccountId);
  if (!token) return { written: false, reason: "token_unavailable" };

  const count = await deps.readFollowersCount({ ...acct, accessToken: token });
  if (count === null) return { written: false, reason: "count_unavailable" };

  await deps.db.query(
    `insert into follower_snapshots (x_account_id, snapshot_date, followers_count)
     values ($1, (now() at time zone 'Asia/Tokyo')::date, $2)
     on conflict (x_account_id, snapshot_date)
     do update set followers_count = excluded.followers_count`,
    [acct.xAccountId, count],
  );
  return { written: true, followersCount: count };
}

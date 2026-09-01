import { EXECUTABLE_SUBSCRIPTION_STATUSES } from "@/lib/auth/subscription-access";
import type { Queryable } from "../x/token-refresh";

/**
 * フォロワー数の記録（K-3, 要件04 §6/§13, 要件02 §3.11, T-M5-14→T-M8-255→T-M8-257）。
 *
 * 記録の入口は**毎時の定時トリガー**（`executeFollowerSnapshot`）の1つだけ——当日分が無い
 * アカウントを毎日1回読み、JST当日分へupsertする（同日は上書き・重複rowを作らない）。
 * 推移グラフ（K-3）は毎日の点が揃って初めて意味を持つため自動で記録する（読取$0.010/アカ/日）。
 * T-M8-255でいったん廃止したが、費用が小さい一方で欠測のグラフは価値が無いためT-M8-257で復活。
 * 復活時に**契約が有効（trialing/active）な利用者だけ読む**ゲートを追加した——解約済み利用者の
 * アカウントを読み続けると使われない費用が毎日積み上がる。
 * 「分析を開始」ボタンからの当日上書きはT-M8-403で廃止した（運営者の指示 2026-09-01。
 * ボタン1つに2つの意味を持たせない）。連携直後は次の毎時起動で最初の点が付く。
 *
 * **過去日の遡り記録はできない**——X API はフォロワー数の履歴を提供せず、取れるのは現在値だけ。
 * 記録が無い日はグラフ上の欠測になる（偽の値で埋めない・原則1）。DB・X読取は注入し純粋に保つ。
 */

export const FOLLOWER_ACCOUNT_LIMIT = 100;
export const FOLLOWER_MAX_PARALLEL = 10;

interface DueAccount {
  xAccountId: string;
  userId: string;
  xUserId: string;
}

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

export interface FollowerSnapshotDeps extends SnapshotFollowerDeps {
  /** Function deadline 超過なら true（未開始分を次回毎時起動へ委ねる）。 */
  isPastDeadline: () => boolean;
  /** account単位の失敗を隔離記録する。 */
  onError?: (scope: { xAccountId: string }, err: unknown) => void;
  limits?: { accounts?: number; parallel?: number };
}

async function upsertToday(db: Queryable, xAccountId: string, count: number): Promise<number> {
  const res = await db.query(
    `insert into follower_snapshots (x_account_id, snapshot_date, followers_count)
     values ($1, (now() at time zone 'Asia/Tokyo')::date, $2)
     on conflict (x_account_id, snapshot_date)
     do update set followers_count = excluded.followers_count`,
    [xAccountId, count],
  );
  return res.rowCount ?? 0;
}

export interface FollowerSnapshotResult {
  accountsProcessed: number;
  snapshotsWritten: number;
  deferred: boolean;
  /** 読み取り／保存に失敗した件数（T-M8-239）。0件と「全部失敗」を区別するため数で持つ。 */
  failed: number;
}

/**
 * 毎時トリガーの本体。JST当日分が無い active アカウント（**所有者の契約が有効なものだけ**・T-M8-257）を
 * 最大 accounts 件選び、最大 parallel 並列で followers_count を読んで upsert する。
 * token/読取失敗や deadline 超過分は deferred で次回毎時起動へ委ねる。
 */
export async function executeFollowerSnapshot(
  deps: FollowerSnapshotDeps,
): Promise<FollowerSnapshotResult> {
  const accountLimit = deps.limits?.accounts ?? FOLLOWER_ACCOUNT_LIMIT;
  const parallel = deps.limits?.parallel ?? FOLLOWER_MAX_PARALLEL;

  const { rows: accounts } = await deps.db.query<DueAccount>(
    `select xa.id as "xAccountId", xa.user_id as "userId", xa.x_user_id as "xUserId"
       from x_accounts xa
       join profiles p on p.id = xa.user_id
      where xa.status = 'active'
        and p.subscription_status::text = any($2)
        and not exists (
          select 1 from follower_snapshots fs
           where fs.x_account_id = xa.id
             and fs.snapshot_date = (now() at time zone 'Asia/Tokyo')::date
        )
      order by xa.created_at asc, xa.id asc
      limit $1`,
    [accountLimit + 1, EXECUTABLE_SUBSCRIPTION_STATUSES],
  );
  // limit+1 件取れたら上限超過（次回へ委ねる分がある）。
  const deferredBySelection = accounts.length > accountLimit;
  const targets = accounts.slice(0, accountLimit);

  let accountsProcessed = 0;
  let snapshotsWritten = 0;
  let deferred = deferredBySelection;
  // 失敗件数（T-M8-239）。握って握りつぶすと「0件」と「全部失敗」が同じ見え方になる。
  let failed = 0;

  const runAccount = async (acct: DueAccount): Promise<void> => {
    if (deps.isPastDeadline()) {
      deferred = true;
      return;
    }
    let token: string | null;
    try {
      token = await deps.getAccessToken(acct.xAccountId);
    } catch (err) {
      failed += 1;
      deps.onError?.({ xAccountId: acct.xAccountId }, err);
      return;
    }
    if (!token) return; // token取得不能はスキップ（次窓で再走査）
    accountsProcessed += 1;
    try {
      const count = await deps.readFollowersCount({
        xAccountId: acct.xAccountId,
        userId: acct.userId,
        xUserId: acct.xUserId,
        accessToken: token,
      });
      if (count === null) {
        deferred = true; // 取得不能は書かず次窓へ
        return;
      }
      snapshotsWritten += await upsertToday(deps.db, acct.xAccountId, count);
    } catch (err) {
      failed += 1;
      deps.onError?.({ xAccountId: acct.xAccountId }, err);
      deferred = true; // 読取/書込失敗は次窓へ
    }
  };

  // 最大 parallel 並列（user token を混在させない）。
  let cursor = 0;
  const workers = Array.from({ length: Math.min(parallel, targets.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      await runAccount(targets[i]);
    }
  });
  await Promise.all(workers);
  return { accountsProcessed, snapshotsWritten, deferred, failed };
}

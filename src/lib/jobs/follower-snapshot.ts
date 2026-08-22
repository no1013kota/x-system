import type { Queryable } from "../x/token-refresh";

/**
 * follower_snapshot 定時トリガーの中核（K-3, 要件04 §6/§13, 要件02 §3.11, T-M5-14）。DB・X読取・deadlineを
 * 注入し純粋に保つ。JST当日分snapshotが無い status=active のXアカウントだけを対象に、user token別で
 * followers_count を読み `follower_snapshots(x_account_id, snapshot_date)` へ upsert する（同日再実行でも
 * unique制約で重複rowを作らない）。1起動100 account・最大10並列、token/読取失敗はaccount単位で隔離して
 * 次回毎時起動へ委ね、deadline超過分も次回へ残す。
 */

export const FOLLOWER_ACCOUNT_LIMIT = 100;
export const FOLLOWER_MAX_PARALLEL = 10;

interface DueAccount {
  xAccountId: string;
  userId: string;
  xUserId: string;
}

export interface FollowerSnapshotDeps {
  db: Queryable;
  /** 対象アカウントの有効access token（token復号/refresh）。取得不能なら null でスキップ。 */
  getAccessToken: (xAccountId: string) => Promise<string | null>;
  /** 自アカウントの followers_count を user token で読む（取得不能は null）。 */
  readFollowersCount: (input: {
    xAccountId: string;
    userId: string;
    xUserId: string;
    accessToken: string;
  }) => Promise<number | null>;
  /** Function deadline 超過なら true（未開始分を次回毎時起動へ委ねる）。 */
  isPastDeadline: () => boolean;
  /** account単位の失敗を隔離記録する。 */
  onError?: (scope: { xAccountId: string }, err: unknown) => void;
  limits?: { accounts?: number; parallel?: number };
}

export interface FollowerSnapshotResult {
  accountsProcessed: number;
  snapshotsWritten: number;
  deferred: boolean;
  /** 読み取り／保存に失敗した件数（T-M8-239）。0件と「全部失敗」を区別するため数で持つ。 */
  failed: number;
}

/**
 * JST当日分が無い active アカウントを最大 accounts 件選び、最大 parallel 並列で followers_count を読んで
 * upsert する。token/読取失敗や deadline 超過分は deferred で次回へ委ねる。
 */
export async function executeFollowerSnapshot(
  deps: FollowerSnapshotDeps,
): Promise<FollowerSnapshotResult> {
  const accountLimit = deps.limits?.accounts ?? FOLLOWER_ACCOUNT_LIMIT;
  const parallel = deps.limits?.parallel ?? FOLLOWER_MAX_PARALLEL;

  const { rows: accounts } = await deps.db.query<DueAccount>(
    `select xa.id as "xAccountId", xa.user_id as "userId", xa.x_user_id as "xUserId"
       from x_accounts xa
      where xa.status = 'active'
        and not exists (
          select 1 from follower_snapshots fs
           where fs.x_account_id = xa.id
             and fs.snapshot_date = (now() at time zone 'Asia/Tokyo')::date
        )
      order by xa.created_at asc, xa.id asc
      limit $1`,
    [accountLimit + 1],
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
      const res = await deps.db.query(
        `insert into follower_snapshots (x_account_id, snapshot_date, followers_count)
         values ($1, (now() at time zone 'Asia/Tokyo')::date, $2)
         on conflict (x_account_id, snapshot_date)
         do update set followers_count = excluded.followers_count`,
        [acct.xAccountId, count],
      );
      snapshotsWritten += res.rowCount ?? 0;
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

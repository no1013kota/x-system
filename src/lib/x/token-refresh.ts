import { randomUUID } from "node:crypto";

import {
  exchangeRefreshToken,
  hasRequiredScopes,
  XTokenError,
  type FetchLike,
  type OAuthClient,
  type XTokenResponse,
} from "./oauth";

/**
 * X access token の single-flight refresh（要件05 §4.3, 要件02 §3.3）。
 *
 * access token が失効5分前になったら、`token_refresh_lock_id`/`token_refresh_locked_at` の
 * 条件付き UPDATE で lease を取り、1実行だけが refresh HTTP を呼ぶ。待機側は最大10秒 poll して
 * 更新済み token を再読込する。1分超の stale lease は別実行が回収する。rotated refresh token と
 * 期限は lock ID 一致を条件に同一 UPDATE で反映し lease を解除する。`invalid_grant`・必要 scope 不足は
 * `status = expired` にして lease を解除し、再連携通知フック（onExpired）を呼ぶ。
 *
 * lease は「行の値」（advisory/session lock ではない）なので Supavisor transaction mode プーラでも
 * 安全。各 DB 操作は `db.query`（＝都度取得・即解放）で行い、refresh HTTP 中に接続を保持しない
 * （要件01 §3.2/§6）。返す平文 access token は server-only 用途（worker）。ブラウザへ返さないこと。
 */

/** 失効までこの時間を切ったら refresh する。 */
export const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
/** 待機側が更新済み token を待つ最大時間。 */
export const TOKEN_REFRESH_WAIT_MAX_MS = 10 * 1000;
/** 待機側の再読込間隔。 */
export const TOKEN_REFRESH_WAIT_POLL_MS = 250;
// stale lease は SQL 側で 1 分（`now() - interval '1 minute'`）で判定する。

/** pg.Pool（および PoolClient）が満たす最小の問い合わせIF。`query` は接続を都度取得・即解放する。 */
export interface Queryable {
  query<T = unknown>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export class XAccountNotConnectedError extends Error {
  readonly code = "x_account_not_connected";
  readonly retryable = false;
  constructor(readonly xAccountId: string) {
    super(`x_account ${xAccountId} is not connected`);
    this.name = "XAccountNotConnectedError";
  }
}

export class XTokenExpiredError extends Error {
  readonly code = "x_token_expired";
  readonly retryable = false;
  constructor(
    readonly xAccountId: string,
    readonly reason: "invalid_grant" | "insufficient_scope" | "no_refresh_token",
  ) {
    super(`x_account ${xAccountId} needs re-link: ${reason}`);
    this.name = "XTokenExpiredError";
  }
}

export class XTokenRefreshTimeoutError extends Error {
  readonly code = "x_token_refresh_in_progress";
  readonly retryable = true;
  constructor(readonly xAccountId: string) {
    super(`x_account ${xAccountId}: token refresh in progress (waited out)`);
    this.name = "XTokenRefreshTimeoutError";
  }
}

interface AccountTokenRow {
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: Date | string | null;
  status: string;
  oauth_scopes: string[];
  auth_type: string;
}

export interface GetValidAccessTokenDeps {
  db: Queryable;
  fetch: FetchLike;
  decrypt: (ciphertext: string) => string;
  encrypt: (plaintext: string) => string;
  /** x_account の auth_type から OAuth client を解決する（BYOK=ユーザーApp/managed=運営App）。 */
  resolveClient: (input: {
    xAccountId: string;
    authType: string;
  }) => OAuthClient | Promise<OAuthClient>;
  /** テスト用の時計（既定 Date.now）。 */
  now?: () => number;
  /** テスト用の待機（既定 setTimeout）。 */
  sleep?: (ms: number) => Promise<void>;
  /** テスト用の lease ID 生成（既定 randomUUID）。 */
  newLockId?: () => string;
  /** status=expired 確定時のフック（再連携通知の作成は通知MSで接続。既定 no-op）。 */
  onExpired?: (xAccountId: string, reason: string) => void | Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const ACCOUNT_COLUMNS = `access_token_ciphertext, refresh_token_ciphertext,
  token_expires_at, status, oauth_scopes, auth_type`;

/**
 * x_account の有効な access token を返す。失効5分前なら single-flight で refresh する。
 * 平文の access token を返す（server-only 用途）。
 */
export async function getValidAccessToken(
  xAccountId: string,
  deps: GetValidAccessTokenDeps,
): Promise<string> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const newLockId = deps.newLockId ?? randomUUID;

  const row = await readAccount(deps.db, xAccountId);
  if (!row) throw new XAccountNotConnectedError(xAccountId);
  if (row.status === "expired") {
    throw new XTokenExpiredError(xAccountId, "invalid_grant");
  }
  if (row.status !== "active" || !row.access_token_ciphertext) {
    throw new XAccountNotConnectedError(xAccountId);
  }
  if (isFresh(row.token_expires_at, now())) {
    return deps.decrypt(row.access_token_ciphertext);
  }

  // --- refresh が必要: single-flight lease を試みる ---
  const lockId = newLockId();
  const leased = await acquireLease(deps.db, xAccountId, lockId);
  if (!leased) {
    // 別実行が refresh 中。最大10秒待って更新済み token を再読込する。
    return waitForFreshToken(xAccountId, deps, now, sleep);
  }

  // lease 取得後にもう一度鮮度確認（取得の直前に別実行が refresh 済みかもしれない）。
  if (leased.access_token_ciphertext && isFresh(leased.token_expires_at, now())) {
    await releaseLease(deps.db, xAccountId, lockId);
    return deps.decrypt(leased.access_token_ciphertext);
  }
  if (!leased.refresh_token_ciphertext) {
    await markExpired(deps.db, xAccountId, lockId);
    await deps.onExpired?.(xAccountId, "no_refresh_token");
    throw new XTokenExpiredError(xAccountId, "no_refresh_token");
  }

  const client = await deps.resolveClient({
    xAccountId,
    authType: leased.auth_type,
  });

  let res: XTokenResponse;
  try {
    res = await exchangeRefreshToken(
      client,
      { refreshToken: deps.decrypt(leased.refresh_token_ciphertext) },
      { fetch: deps.fetch },
    );
  } catch (err) {
    if (err instanceof XTokenError && err.errorCode === "invalid_grant") {
      await markExpired(deps.db, xAccountId, lockId);
      await deps.onExpired?.(xAccountId, "invalid_grant");
      throw new XTokenExpiredError(xAccountId, "invalid_grant");
    }
    // network/5xx 等の一時エラー: lease を解除して retryable のまま伝播する。
    await releaseLease(deps.db, xAccountId, lockId);
    throw err;
  }

  // scope 検証: refresh 応答が scope を返し必須 scope を欠く場合は再連携。
  const newScopes = res.scope
    ? res.scope.split(" ").filter(Boolean)
    : leased.oauth_scopes;
  if (!hasRequiredScopes(newScopes)) {
    await markExpired(deps.db, xAccountId, lockId);
    await deps.onExpired?.(xAccountId, "insufficient_scope");
    throw new XTokenExpiredError(xAccountId, "insufficient_scope");
  }

  const accessCt = deps.encrypt(res.access_token);
  // rotated refresh が返らない場合は既存を維持する。
  const refreshCt = res.refresh_token
    ? deps.encrypt(res.refresh_token)
    : leased.refresh_token_ciphertext;
  const expiresAt = res.expires_in
    ? new Date(now() + res.expires_in * 1000).toISOString()
    : null;

  // lock ID 一致を条件に、token/期限/scope の反映と lease 解除を同一 UPDATE で行う。
  const applied = await applyRefreshedTokens(deps.db, xAccountId, lockId, {
    accessCt,
    refreshCt,
    expiresAt,
    scopes: newScopes,
  });
  if (!applied) {
    // lease を別実行に奪われていた（stale 回収等）。自分の更新は破棄し、有効 token を再読込する。
    return waitForFreshToken(xAccountId, deps, now, sleep);
  }
  return res.access_token;
}

function isFresh(expiresAt: Date | string | null, nowMs: number): boolean {
  if (!expiresAt) return false; // 期限不明は refresh 対象とする
  const exp =
    typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt.getTime();
  if (Number.isNaN(exp)) return false;
  return exp - nowMs > TOKEN_REFRESH_THRESHOLD_MS;
}

async function readAccount(
  db: Queryable,
  id: string,
): Promise<AccountTokenRow | null> {
  const { rows } = await db.query<AccountTokenRow>(
    `select ${ACCOUNT_COLUMNS} from x_accounts where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** 条件付き UPDATE で lease を取得する。取得できたら現在の行を返し、できなければ null。 */
async function acquireLease(
  db: Queryable,
  id: string,
  lockId: string,
): Promise<AccountTokenRow | null> {
  const { rows } = await db.query<AccountTokenRow>(
    `update x_accounts
        set token_refresh_lock_id = $2, token_refresh_locked_at = now()
      where id = $1 and status = 'active'
        and (token_refresh_lock_id is null
             or token_refresh_locked_at < now() - interval '1 minute')
      returning ${ACCOUNT_COLUMNS}`,
    [id, lockId],
  );
  return rows[0] ?? null;
}

async function releaseLease(
  db: Queryable,
  id: string,
  lockId: string,
): Promise<void> {
  await db.query(
    `update x_accounts
        set token_refresh_lock_id = null, token_refresh_locked_at = null
      where id = $1 and token_refresh_lock_id = $2`,
    [id, lockId],
  );
}

async function markExpired(
  db: Queryable,
  id: string,
  lockId: string,
): Promise<void> {
  await db.query(
    `update x_accounts
        set status = 'expired',
            token_refresh_lock_id = null,
            token_refresh_locked_at = null
      where id = $1 and token_refresh_lock_id = $2`,
    [id, lockId],
  );
}

async function applyRefreshedTokens(
  db: Queryable,
  id: string,
  lockId: string,
  t: {
    accessCt: string;
    refreshCt: string | null;
    expiresAt: string | null;
    scopes: string[];
  },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update x_accounts
        set access_token_ciphertext = $3,
            refresh_token_ciphertext = $4,
            token_expires_at = $5,
            oauth_scopes = $6,
            status = 'active',
            token_refresh_lock_id = null,
            token_refresh_locked_at = null
      where id = $1 and token_refresh_lock_id = $2`,
    [id, lockId, t.accessCt, t.refreshCt, t.expiresAt, t.scopes],
  );
  return (rowCount ?? 0) > 0;
}

async function waitForFreshToken(
  xAccountId: string,
  deps: GetValidAccessTokenDeps,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  const deadline = now() + TOKEN_REFRESH_WAIT_MAX_MS;
  for (;;) {
    await sleep(TOKEN_REFRESH_WAIT_POLL_MS);
    const row = await readAccount(deps.db, xAccountId);
    if (!row) throw new XAccountNotConnectedError(xAccountId);
    if (row.status === "expired") {
      throw new XTokenExpiredError(xAccountId, "invalid_grant");
    }
    if (row.access_token_ciphertext && isFresh(row.token_expires_at, now())) {
      return deps.decrypt(row.access_token_ciphertext);
    }
    if (now() >= deadline) {
      throw new XTokenRefreshTimeoutError(xAccountId);
    }
  }
}

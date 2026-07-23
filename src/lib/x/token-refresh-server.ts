import "server-only";

import { decrypt, encrypt } from "../crypto";
import { getPool } from "../db/pool";
import type { FetchLike } from "./oauth";
import { managedOAuthClient } from "./oauth-server";
import {
  createXRelinkNotification,
  getValidAccessToken,
  type GetValidAccessTokenDeps,
  type Queryable,
} from "./token-refresh";

/**
 * X token refresh の server-only 配線（要件05 §4.3）。pool・crypto・運営App資格情報を束ねて
 * 純粋層（`token-refresh.ts`）をアプリの実値で使う。DB 操作は `pool.query`（都度取得・即解放）で行い、
 * refresh HTTP 中に接続を保持しない。
 *
 * BYOK（auth_type='byok'）のユーザーApp資格情報（user_api_keys provider='x' の client_id/secret）の
 * 解決は X連携マイルストーンで追加する（T-M0-20 後続注記）。それまで BYOK は明示エラーにする。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>,
};

const fetchLike: FetchLike = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });

const resolveClient: GetValidAccessTokenDeps["resolveClient"] = ({ authType }) => {
  if (authType === "managed") return managedOAuthClient();
  throw new Error(
    "BYOK X app credential resolution is implemented in the X-integration milestone",
  );
};

/**
 * x_account の有効な access token を返す（single-flight refresh 込み）。server-only。
 * 返す平文 token はブラウザへ返さないこと（要件02 §5）。
 * 既定では status=expired 遷移時に再連携通知（type='error'）を作成する（要件05 §4.3）。
 * 呼び出し側が onExpired を渡した場合はそれを優先する。
 */
export function getValidXAccessToken(
  xAccountId: string,
  onExpired?: (xAccountId: string, reason: string) => void | Promise<void>,
): Promise<string> {
  return getValidAccessToken(xAccountId, {
    db: pooledDb,
    fetch: fetchLike,
    decrypt,
    encrypt,
    resolveClient,
    onExpired:
      onExpired ??
      ((id, reason) => createXRelinkNotification(pooledDb, id, reason)),
  });
}

import "server-only";

import { getXAppCredentialsForUser } from "../api-key-store-server";
import { decrypt, encrypt } from "../crypto";
import { pooledQueryable } from "../db/pool";
import { AppError } from "../observability/errors";
import type { FetchLike } from "./oauth";
import { managedOAuthClient, xRedirectUri } from "./oauth-server";
import {
  createXRelinkNotification,
  getValidAccessToken,
  type GetValidAccessTokenDeps,
} from "./token-refresh";

/**
 * X token refresh の server-only 配線（要件05 §4.3）。pool・crypto・運営/ユーザーApp資格情報を束ねて
 * 純粋層（`token-refresh.ts`）をアプリの実値で使う。DB 操作は `pool.query`（都度取得・即解放）で行い、
 * refresh HTTP 中に接続を保持しない。
 *
 * BYOK（auth_type='byok'）は x_account 所有者の保存済みX App資格情報（user_api_keys provider='x'）を
 * OAuth clientとして解決する。confidential clientのみsecretを付ける（要件05 §4.1）。
 */

const pooledDb = pooledQueryable();

const fetchLike: FetchLike = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });

const resolveClient: GetValidAccessTokenDeps["resolveClient"] = async ({
  xAccountId,
  authType,
}) => {
  if (authType === "managed") return managedOAuthClient();
  const { rows } = await pooledDb.query<{ user_id: string }>(
    `select user_id from x_accounts where id = $1`,
    [xAccountId],
  );
  const userId = rows[0]?.user_id;
  const creds = userId ? await getXAppCredentialsForUser(userId) : null;
  if (!creds) {
    throw new AppError("api_key_required", {
      details: { purpose: "x", settingsPath: "/app/settings?tab=api-keys" },
    });
  }
  return {
    clientId: creds.clientId,
    clientSecret:
      creds.clientType === "confidential" && creds.clientSecret
        ? creds.clientSecret
        : undefined,
    redirectUri: xRedirectUri(),
  };
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

import "server-only";

import { cache } from "react";

import { getXAppCredentialsForUser } from "../api-key-store-server";
import { decrypt } from "../crypto";
import { pooledQueryable, runInPooledTx } from "../db/pool";
import { getMe } from "./client";
import { xClientDeps } from "./client-server";
import { revokeOAuthToken, type FetchLike } from "./oauth";
import { managedOAuthClient } from "./oauth-server";
import {
  disconnectXAccount,
  enableXAccount,
  listXAccountsForUser,
  refreshXAccountStatus,
  resolveActiveXAccount,
  setActiveXAccount,
  type XAccountListItem,
  type XMeFetcher,
} from "./account-actions";
import { getValidXAccessToken } from "./token-refresh-server";

export type { XAccountListItem } from "./account-actions";

/**
 * Xアカウント管理Actionの server-only 配線（要件05 §4.3）。pool・crypto・X APIクライアント・
 * token refresh・token revoke を束ねて純粋層（`account-actions.ts`）をアプリの実値で使う。
 */

const pooledDb = pooledQueryable();

const runInTx = runInPooledTx;

const fetchLike: FetchLike = (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body });

const fetchMe: XMeFetcher = async (accessToken) =>
  (await getMe(accessToken, xClientDeps())).user;

/**
 * best effort の token revoke。x_account の refresh token（無ければaccess token）を復号し、
 * auth_type に応じた client_id で失効する。呼び出し側（純粋層）が失敗を握りつぶす。
 */
async function revokeForAccount(xAccountId: string): Promise<void> {
  const { rows } = await pooledDb.query<{
    user_id: string;
    auth_type: string;
    refresh_token_ciphertext: string | null;
    access_token_ciphertext: string | null;
  }>(
    `select user_id, auth_type, refresh_token_ciphertext, access_token_ciphertext
       from x_accounts where id = $1`,
    [xAccountId],
  );
  const row = rows[0];
  if (!row) return;
  const ciphertext = row.refresh_token_ciphertext ?? row.access_token_ciphertext;
  if (!ciphertext) return;
  const clientId =
    row.auth_type === "managed"
      ? managedOAuthClient().clientId
      : (await getXAppCredentialsForUser(row.user_id))?.clientId;
  if (!clientId) return;
  await revokeOAuthToken({ clientId }, { token: decrypt(ciphertext) }, {
    fetch: fetchLike,
  });
}

export function listXAccounts(userId: string): Promise<XAccountListItem[]> {
  return listXAccountsForUser(pooledDb, userId);
}

export function refreshXAccountStatusForUser(
  xAccountId: string,
  userId: string,
): Promise<{ status: string }> {
  return refreshXAccountStatus(xAccountId, userId, {
    db: pooledDb,
    getAccessToken: (id) => getValidXAccessToken(id),
    fetchMe,
  });
}

export function enableXAccountForUser(
  xAccountId: string,
  userId: string,
): Promise<{ status: string }> {
  return enableXAccount(xAccountId, userId, {
    db: pooledDb,
    runInTx,
    getAccessToken: (id) => getValidXAccessToken(id),
    fetchMe,
  });
}

export function disconnectXAccountForUser(
  xAccountId: string,
  userId: string,
): Promise<{ status: string }> {
  return disconnectXAccount(xAccountId, userId, {
    db: pooledDb,
    runInTx,
    revoke: revokeForAccount,
  });
}

export function setActiveXAccountForUser(
  xAccountId: string,
  userId: string,
): Promise<void> {
  return setActiveXAccount(xAccountId, userId, pooledDb);
}

/**
 * /app系レイアウト読込時のフォールバック解決＋永続化。選択中の有効なactive idを返す（無ければnull）。
 *
 * React `cache()` でリクエスト内メモ化する（T-M8-67）: layout と各ページの両方が呼ぶため、
 * 素のままだと同じ解決処理（1〜2クエリ＋条件次第でUPDATE）が毎画面2回走っていた。
 */
export const resolveActiveXAccountForUser = cache(
  (userId: string): Promise<string | null> => resolveActiveXAccount(pooledDb, userId),
);

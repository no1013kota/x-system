import type { PoolClient } from "pg";

import { AppError } from "@/lib/observability/errors";

import {
  hasRequiredScopes,
  type OAuthClient,
  type OAuthTransaction,
  type SealedTokens,
  type XTokenResponse,
} from "./oauth";

/**
 * GET /api/x/oauth/callback の中核（T-M2-13, A-3/A-4, 要件05 §4.3, 要件02 §3.3）。
 * state検証→（cookie-forcing防御でtx.userId===session一致）→code交換→scope5種確認→/2/users/me→
 * token暗号化保存＋x_accounts作成 の新規連携ハッピーパス。DB・crypto・HTTPは注入し純粋に保つ。
 * token平文・外部レスポンス本文はブラウザへ返さない（route層はcode/messageのみredirect）。
 * 自動投稿同意（automation_consent_*）は一切記録しない。
 */

export interface XCallbackUser {
  id: string;
  username: string;
  name: string;
  profileImageUrl: string | null;
}

export interface XCallbackPersistParams {
  userId: string;
  authType: OAuthTransaction["authType"];
  xUser: XCallbackUser;
  sealed: SealedTokens;
}

export interface XOAuthCallbackDeps {
  verifyState: (
    sealed: string | undefined | null,
    returnedState: string,
  ) => OAuthTransaction;
  resolveClient: (
    userId: string,
    authType: OAuthTransaction["authType"],
  ) => OAuthClient | Promise<OAuthClient>;
  exchangeCode: (
    client: OAuthClient,
    input: { code: string; codeVerifier: string },
  ) => Promise<XTokenResponse>;
  fetchMe: (accessToken: string) => Promise<XCallbackUser>;
  sealTokens: (res: XTokenResponse) => SealedTokens;
  persist: (params: XCallbackPersistParams) => Promise<string>;
}

export interface XOAuthCallbackResult {
  returnPath: string;
  xAccountId: string;
  xUserId: string;
}

export async function handleXOAuthCallback(
  input: {
    code: string;
    returnedState: string;
    sealedStateCookie: string | undefined | null;
    sessionUserId: string;
  },
  deps: XOAuthCallbackDeps,
): Promise<XOAuthCallbackResult> {
  // state cookie検証（改ざん・TTL・state不一致を拒否。verifyStateが投げる）。
  const tx = deps.verifyState(input.sealedStateCookie, input.returnedState);

  // cookie-forcing / session-fixation 防御（T-M0-20注）: stateのuserIdは認証sessionと一致必須。
  if (tx.userId !== input.sessionUserId) {
    throw new AppError("forbidden", {
      details: { reason: "oauth_session_mismatch" },
    });
  }

  const client = await deps.resolveClient(tx.userId, tx.authType);
  const token = await deps.exchangeCode(client, {
    code: input.code,
    codeVerifier: tx.codeVerifier,
  });

  // scope 5種の付与確認。不足はtoken保存前にエラー。
  const scopes = token.scope ? token.scope.split(" ").filter(Boolean) : [];
  if (!hasRequiredScopes(scopes)) {
    throw new AppError("forbidden", { details: { reason: "insufficient_scope" } });
  }

  // /2/users/me 確認。失敗時はthrow→token保存しない。
  const xUser = await deps.fetchMe(token.access_token);

  const sealed = deps.sealTokens(token);
  const xAccountId = await deps.persist({
    userId: tx.userId,
    authType: tx.authType,
    xUser,
    sealed,
  });
  return { returnPath: tx.returnPath, xAccountId, xUserId: xUser.id };
}

/**
 * x_accounts への連携保存（要件02 §3.3）。同一 (user_id, x_user_id) は token/scope/auth_type/status
 * を置き換え、base_md・settings・automation_consent_* 等の既存データは保持する（upsert）。
 * BYOKはOAuth完了の疎通成功でXキーを valid 化（A-4）。active_x_account_id 未設定なら当該連携を設定。
 * 呼び出し側が withTransaction で包む。sealed は暗号化済み ciphertext。
 */
export async function linkXAccountRecord(
  client: PoolClient,
  params: XCallbackPersistParams,
): Promise<string> {
  const { userId, authType, xUser, sealed } = params;
  const inserted = await client.query<{ id: string }>(
    `insert into x_accounts
       (user_id, x_user_id, handle, name, profile_image_url, auth_type,
        access_token_ciphertext, refresh_token_ciphertext, oauth_scopes,
        token_expires_at, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active')
     on conflict (user_id, x_user_id) do update
       set handle = excluded.handle,
           name = excluded.name,
           profile_image_url = excluded.profile_image_url,
           auth_type = excluded.auth_type,
           access_token_ciphertext = excluded.access_token_ciphertext,
           refresh_token_ciphertext = excluded.refresh_token_ciphertext,
           oauth_scopes = excluded.oauth_scopes,
           token_expires_at = excluded.token_expires_at,
           status = 'active',
           token_refresh_lock_id = null,
           token_refresh_locked_at = null
     returning id`,
    [
      userId,
      xUser.id,
      xUser.username,
      xUser.name,
      xUser.profileImageUrl,
      authType,
      sealed.accessTokenCiphertext,
      sealed.refreshTokenCiphertext,
      sealed.oauthScopes,
      sealed.tokenExpiresAt,
    ],
  );
  const xAccountId = inserted.rows[0].id;

  if (authType === "byok") {
    await client.query(
      `update user_api_keys set status = 'valid', verified_at = now()
        where user_id = $1 and provider = 'x'`,
      [userId],
    );
  }

  await client.query(
    `update profiles set active_x_account_id = $2
      where id = $1 and active_x_account_id is null`,
    [userId, xAccountId],
  );
  return xAccountId;
}

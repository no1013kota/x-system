import type { PoolClient } from "pg";

import { requireExecutableSubscription } from "@/lib/auth/subscription-access";
import { AppError } from "@/lib/observability/errors";
import { PLANS, type PlanId } from "@/lib/plans";

import {
  hasRequiredScopes,
  type OAuthClient,
  type OAuthTransaction,
  type SealedTokens,
  type XTokenResponse,
} from "./oauth";

const X_SETTINGS_PATH = "/app/settings?tab=api-keys";

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

  // **再連携で別のXアカウントを認可したら、黙って新規追加しない**（T-M8-53）。
  //
  // 「再連携」は特定の行を直す操作なので、違うアカウントで認可されたら**利用者の意図と違う**。
  // 以前はここが無く、新しい行が増えて壊れた行はそのまま残った（押した本人は直ったつもりになる）。
  if (tx.reconnectXUserId && tx.reconnectXUserId !== xUser.id) {
    throw new AppError("forbidden", {
      details: { reason: "reconnect_account_mismatch", authorizedHandle: xUser.username },
    });
  }

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
 * 連携可否の認可（要件05 §4.3・要件03 §6, T-M2-14）。callbackでも契約状態とplan上限を再確認し、
 * start〜callback間のplan変更や並行連携による上限超過を防ぐ。同一 (user_id, x_user_id) の再連携は
 * 既存rowの置換なので上限対象外。profiles を FOR UPDATE で読み、同一transaction内のinsertと直列化する
 * （並行callbackが同時に上限を通過するのを防ぐ）。期待auth_typeはsealed stateで既に束縛済み。
 */
export async function assertCanLinkXAccount(
  client: PoolClient,
  params: { userId: string; xUserId: string },
): Promise<void> {
  const prof = (
    await client.query<{ plan: PlanId; subscription_status: string }>(
      "select plan, subscription_status from profiles where id = $1 for update",
      [params.userId],
    )
  ).rows[0];
  if (!prof) throw new AppError("not_found");
  requireExecutableSubscription(prof.subscription_status);

  const isRelink =
    (
      await client.query(
        "select 1 from x_accounts where user_id = $1 and x_user_id = $2",
        [params.userId, params.xUserId],
      )
    ).rows.length > 0;
  if (isRelink) return; // 別のX userでない再連携はtokenを置換するだけ→上限対象外

  const active = (
    await client.query<{ n: number }>(
      "select count(*)::int as n from x_accounts where user_id = $1 and status = 'active'",
      [params.userId],
    )
  ).rows[0].n;
  if (active >= PLANS[prof.plan].xAccountLimit) {
    throw new AppError("forbidden", {
      details: {
        reason: "x_account_limit_reached",
        limit: PLANS[prof.plan].xAccountLimit,
        settingsPath: X_SETTINGS_PATH,
      },
    });
  }
}

/**
 * x_accounts への連携保存（要件02 §3.3）。同一 (user_id, x_user_id) は token/scope/auth_type/status
 * を置き換え、base_md・settings・automation_consent_* 等の既存データは保持する（upsert）。
 * 別のX userは新規アカウントとして契約状態・plan上限を検証し、超過時は保存しない（T-M2-14, 要件03 §6）。
 * BYOKはOAuth完了の疎通成功でXキーを valid 化（A-4）。active_x_account_id 未設定なら当該連携を設定。
 * 呼び出し側が withTransaction で包む。sealed は暗号化済み ciphertext。
 */
export async function linkXAccountRecord(
  client: PoolClient,
  params: XCallbackPersistParams,
): Promise<string> {
  const { userId, authType, xUser, sealed } = params;
  await assertCanLinkXAccount(client, { userId, xUserId: xUser.id });
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
           -- 解除したアカウントを連携し直したら一覧へ戻す（T-M8-54）。
           disconnected_at = null,
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

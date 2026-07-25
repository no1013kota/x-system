import "server-only";

import { encrypt } from "../crypto";
import { resolveKey } from "../crypto/envelope";
import { env } from "../env";
import {
  X_OAUTH_STATE_MAX_AGE_SEC,
  sealOAuthTransaction,
  sealTokenResponse,
  verifyOAuthCallback,
  type OAuthClient,
  type OAuthTransaction,
  type SealedTokens,
  type XTokenResponse,
} from "./oauth";

/**
 * X OAuth クライアント基盤の server-only 配線（要件05 §4.3/§11, 要件01 §3.4/§8）。
 * env（managed App資格情報・redirect path・暗号鍵）と crypto を束ね、純粋層（`oauth.ts`）を
 * アプリの実値で使えるようにする。BYOKのユーザーApp資格情報の解決とroute実装（start/callback）は
 * X連携マイルストーンで追加する。
 */

/** state cookie名。認証補助cookie（要件01 §8）。 */
export const X_OAUTH_STATE_COOKIE = "x_oauth_tx";

/** redirect_uri = APP_BASE_URL + X_OAUTH_REDIRECT_PATH（要件01 §3.1/§3.4）。 */
export function xRedirectUri(): string {
  return `${env.APP_BASE_URL}${env.X_OAUTH_REDIRECT_PATH}`;
}

/** premium（managed）用の運営App OAuthクライアント。secretがあれば confidential client。 */
export function managedOAuthClient(): OAuthClient {
  const clientId = env.X_MANAGED_CLIENT_ID;
  if (!clientId) throw new Error("X_MANAGED_CLIENT_ID is not configured");
  return {
    clientId,
    clientSecret: env.X_MANAGED_CLIENT_SECRET,
    redirectUri: xRedirectUri(),
  };
}

function stateKey(): Buffer {
  const raw = env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured");
  return resolveKey(raw);
}

/** state cookieの属性（要件01 §8: HttpOnly・Secure(prod)・SameSite=Lax・短TTL）。 */
export function xOAuthStateCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: env.APP_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: X_OAUTH_STATE_MAX_AGE_SEC,
  };
}

export function sealState(tx: OAuthTransaction): string {
  return sealOAuthTransaction(tx, stateKey());
}

export function verifyState(
  sealed: string | undefined | null,
  returnedState: string,
): OAuthTransaction {
  return verifyOAuthCallback(sealed, stateKey(), {
    returnedState,
    now: Date.now(),
  });
}

/** token応答を x_accounts 保存形式（AES envelope）へ封緘する。 */
export function sealTokens(res: XTokenResponse): SealedTokens {
  return sealTokenResponse(res, encrypt, Date.now());
}

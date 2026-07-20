import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { decryptWithKey, encryptWithKey } from "../crypto/envelope";

/**
 * X (Twitter) OAuth 2.0 Authorization Code + PKCE クライアント基盤（PRD A-3/A-4/§8.1,
 * 要件05 §4.3/§11, 要件01 §3.4）。ここはSDK非依存・server-only非依存の純粋層で、fetchと
 * 暗号鍵は注入する（テスト可能に保つ）。env/crypto束ね・cookie属性は `oauth-server.ts`。
 *
 * 公式仕様（docs.x.com, 2026-07-21 確認）:
 * - authorize: https://x.com/i/oauth2/authorize（response_type/client_id/redirect_uri/
 *   scope〔space区切り〕/state/code_challenge/code_challenge_method=S256）
 * - token: https://api.x.com/2/oauth2/token（form-urlencoded）。confidential clientは
 *   `Authorization: Basic base64(client_id:client_secret)` でclient_idをbodyに含めない。
 *   public clientはclient_idをbodyに入れBasicは付けない。
 * - offline.access が付与されたときだけ refresh_token が返る。
 * PKCE は RFC 7636（code_verifier 43-128文字・unreserved、challenge=base64url(sha256(verifier))）。
 */

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

/** 要求scope（順序・space区切り。PRD §8.1 / 要件05 §4.3）。 */
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "media.write",
  "offline.access",
] as const;

/** OAuth stateの既定TTL。仕様は「短TTL」のみ規定のため技術判断で10分。 */
export const X_OAUTH_STATE_MAX_AGE_SEC = 600;

export type XAuthType = "byok" | "managed";

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** RFC 7636 準拠の code_verifier（32バイト乱数→base64url=43文字, unreserved charset）。 */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256: code_challenge = base64url(sha256(ASCII(code_verifier)))、padding無し。 */
export function computeCodeChallenge(codeVerifier: string): string {
  return base64url(createHash("sha256").update(codeVerifier).digest());
}

export interface Pkce {
  codeVerifier: string;
  codeChallenge: string;
  method: "S256";
}

export function createPkce(): Pkce {
  const codeVerifier = generateCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: computeCodeChallenge(codeVerifier),
    method: "S256",
  };
}

// ---------------------------------------------------------------------------
// Authorize URL
// ---------------------------------------------------------------------------

/**
 * authorize URLを組み立てる。`clientId` はBYOK（ユーザーApp）/managed（運営App）で
 * 呼び出し側が渡し分ける。scopeとredirect_uriは %20/%3A で明示エンコードする（X docs例に合わせる）。
 */
export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const pairs: Array<[string, string]> = [
    ["response_type", "code"],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["scope", (params.scopes ?? X_SCOPES).join(" ")],
    ["state", params.state],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", "S256"],
  ];
  const query = pairs
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${X_AUTHORIZE_URL}?${query}`;
}

/** 付与済みscopeに必須5 scopeがすべて含まれるか（callbackの検証で使用, 要件05 §4.3）。 */
export function hasRequiredScopes(granted: readonly string[]): boolean {
  return X_SCOPES.every((s) => granted.includes(s));
}

// ---------------------------------------------------------------------------
// OAuth transaction state (signed + encrypted cookie payload)
// ---------------------------------------------------------------------------

export interface OAuthTransaction {
  userId: string;
  authType: XAuthType;
  returnPath: string;
  state: string;
  codeVerifier: string;
  /** epoch ms。TTL検証に使う。 */
  issuedAt: number;
}

export class OAuthStateError extends Error {
  readonly code = "invalid_oauth_state";
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

/** state値＋PKCE verifierを含むトランザクションを新規作成する。 */
export function newOAuthTransaction(input: {
  userId: string;
  authType: XAuthType;
  returnPath: string;
  now: number;
  state?: string;
  codeVerifier?: string;
}): OAuthTransaction {
  return {
    userId: input.userId,
    authType: input.authType,
    returnPath: input.returnPath,
    state: input.state ?? base64url(randomBytes(24)),
    codeVerifier: input.codeVerifier ?? generateCodeVerifier(),
    issuedAt: input.now,
  };
}

/**
 * トランザクションをcookie値へ封緘する。AES-256-GCM envelope（暗号化＋認証タグ）なので
 * 改ざん検知（＝署名）と機密性の両方を満たす（要件05 §11「署名・暗号化」）。
 */
export function sealOAuthTransaction(tx: OAuthTransaction, key: Buffer): string {
  return encryptWithKey(JSON.stringify(tx), key);
}

/** 封緘cookie値を復号して取り出す。改ざん時はGCM auth tag不一致で例外（→呼び出し側でOAuthStateErrorへ）。 */
export function openOAuthTransaction(sealed: string, key: Buffer): OAuthTransaction {
  return JSON.parse(decryptWithKey(sealed, key)) as OAuthTransaction;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * callbackでstate cookieを検証する（要件05 §4.3/§11）。改ざん・TTL超過・state不一致
 * （OAuth標準のstate CSRF防御）を拒否し、通過したトランザクション
 * （userId/authType/returnPath/codeVerifier）を返す。
 *
 * 呼び出し側（callback route）の必須義務: 返り値 `tx.userId` を**認証済みsessionのuserIdと
 * 一致検証**すること。stateだけではcookie-forcing/session-fixation（攻撃者が自分のsealed
 * cookieとmatchするstateを被害者ブラウザへ植え付ける）を防げないため、session一致検証で
 * アカウント紐付けの乗っ取りを防ぐ（この純粋層はsession非依存のため検証できない）。
 */
export function verifyOAuthCallback(
  sealed: string | undefined | null,
  key: Buffer,
  opts: { returnedState: string; now: number; maxAgeSec?: number },
): OAuthTransaction {
  if (!sealed) throw new OAuthStateError("state cookie is missing");
  let tx: OAuthTransaction;
  try {
    tx = openOAuthTransaction(sealed, key);
  } catch {
    throw new OAuthStateError("state cookie is missing or tampered");
  }
  const maxAgeSec = opts.maxAgeSec ?? X_OAUTH_STATE_MAX_AGE_SEC;
  if (opts.now - tx.issuedAt > maxAgeSec * 1000) {
    throw new OAuthStateError("state expired");
  }
  if (!safeEqual(tx.state, opts.returnedState)) {
    throw new OAuthStateError("state mismatch (cross-session callback rejected)");
  }
  return tx;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** clientSecret があれば confidential client（Basic auth）、無ければ public client。 */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

export class XTokenError extends Error {
  constructor(
    readonly status: number,
    /** X の error コード（invalid_grant 等）。tokenやsecretは含めない。 */
    readonly errorCode: string | null,
  ) {
    super(`x token endpoint error ${status}: ${errorCode ?? "unknown"}`);
    this.name = "XTokenError";
  }
}

function tokenAuth(client: OAuthClient): {
  headers: Record<string, string>;
  includeClientIdInBody: boolean;
} {
  if (client.clientSecret) {
    const basic = Buffer.from(
      `${client.clientId}:${client.clientSecret}`,
    ).toString("base64");
    return { headers: { authorization: `Basic ${basic}` }, includeClientIdInBody: false };
  }
  return { headers: {}, includeClientIdInBody: true };
}

async function postToken(
  client: OAuthClient,
  params: Record<string, string>,
  deps: { fetch: FetchLike },
): Promise<XTokenResponse> {
  const { headers, includeClientIdInBody } = tokenAuth(client);
  const body = new URLSearchParams(params);
  if (includeClientIdInBody) body.set("client_id", client.clientId);

  const res = await deps.fetch(X_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let errorCode: string | null = null;
    try {
      errorCode = (JSON.parse(text) as { error?: string }).error ?? null;
    } catch {
      errorCode = null;
    }
    throw new XTokenError(res.status, errorCode);
  }
  return JSON.parse(text) as XTokenResponse;
}

/** authorization code → token 交換（要件05 §4.3）。 */
export function exchangeCodeForToken(
  client: OAuthClient,
  input: { code: string; codeVerifier: string },
  deps: { fetch: FetchLike },
): Promise<XTokenResponse> {
  return postToken(
    client,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: client.redirectUri,
      code_verifier: input.codeVerifier,
    },
    deps,
  );
}

// ---------------------------------------------------------------------------
// Token sealing (AES envelope for x_accounts storage)
// ---------------------------------------------------------------------------

export interface SealedTokens {
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  tokenExpiresAt: string | null;
  oauthScopes: string[];
}

/**
 * token応答を x_accounts 保存形式へ封緘する（access/refresh を AES envelope 暗号化,
 * 要件02 §3.3/§3 intro）。`encrypt` は注入（server層は crypto.encrypt を渡す）。
 */
export function sealTokenResponse(
  res: XTokenResponse,
  encrypt: (plaintext: string) => string,
  now: number,
): SealedTokens {
  return {
    accessTokenCiphertext: encrypt(res.access_token),
    refreshTokenCiphertext: res.refresh_token ? encrypt(res.refresh_token) : null,
    tokenExpiresAt: res.expires_in
      ? new Date(now + res.expires_in * 1000).toISOString()
      : null,
    oauthScopes: res.scope ? res.scope.split(" ").filter(Boolean) : [],
  };
}

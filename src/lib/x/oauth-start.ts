import type { XAppCredentials } from "@/lib/api-keys";
import { requireExecutableSubscription } from "@/lib/auth/subscription-access";
import { AppError } from "@/lib/observability/errors";
import { PLANS, type PlanId } from "@/lib/plans";

import {
  buildAuthorizeUrl,
  createPkce,
  newOAuthTransaction,
  X_SCOPES,
  type OAuthClient,
  type OAuthTransaction,
  type XAuthType,
} from "./oauth";

/**
 * GET /api/x/oauth/start の中核（T-M2-12, A-3, 要件05 §3/§4.3/§11, 要件01 §3.4/§8, PRD §8.1）。
 * 契約状態・plan上限・期待auth_type（standard/md=byok, premium=managed）を検証し、5 scope＋S256 PKCE
 * の認可URLと、state/code_verifierを封緘したcookie値を返す。DB・crypto・envは注入し純粋に保つ。
 * 不足時は AppError（settingsPath付き）を投げ、route層が設定導線へredirectする。
 */

const X_KEY_SETTINGS_PATH = "/app/settings?tab=api-keys";
const DEFAULT_RETURN_PATH = "/app/settings?tab=api-keys";

/** premiumは運営App(managed)、standard/mdはユーザーApp(byok)。 */
export function expectedAuthTypeForPlan(plan: PlanId): XAuthType {
  return plan === "premium" ? "managed" : "byok";
}

export interface XOAuthStartProfile {
  plan: PlanId;
  subscriptionStatus: string;
}

export interface XOAuthStartDeps {
  getProfile: (userId: string) => Promise<XOAuthStartProfile | null>;
  /** 上限判定に使う active な連携数。 */
  getActiveXAccountCount: (userId: string) => Promise<number>;
  /** BYOK: ユーザー保存のX App資格情報（未保存はnull）。 */
  getByokClient: (userId: string) => Promise<XAppCredentials | null>;
  /** managed: 運営App OAuth client（env未設定は投げる＝設定エラー）。 */
  managedClient: () => OAuthClient;
  redirectUri: string;
  sealState: (tx: OAuthTransaction) => string;
  now: () => number;
}

export interface XOAuthStartResult {
  authorizeUrl: string;
  sealedState: string;
  authType: XAuthType;
}

export async function buildXOAuthStart(
  input: { userId: string; returnPath?: string; reconnectXUserId?: string },
  deps: XOAuthStartDeps,
): Promise<XOAuthStartResult> {
  const profile = await deps.getProfile(input.userId);
  if (!profile) throw new AppError("not_found");

  // 契約状態: trialing/active のみ実行可（要件05 §1・要件03 §5）。
  requireExecutableSubscription(profile.subscriptionStatus);

  const authType = expectedAuthTypeForPlan(profile.plan);

  // plan上限: active な連携が上限に達していたら新規連携を止める（設定導線へ戻す）。
  //
  // **再連携は新規ではないので数えない**（T-M8-53）。上限まで使っていると失効アカウントを
  // 直せなくなり、「壊れているのに直す手段が無い」行き止まりになる（callback側の
  // `assertCanLinkXAccount` も同一 x_user_id を上限対象外にしている）。
  const active = input.reconnectXUserId ? 0 : await deps.getActiveXAccountCount(input.userId);
  if (active >= PLANS[profile.plan].xAccountLimit) {
    throw new AppError("forbidden", {
      details: {
        reason: "x_account_limit_reached",
        limit: PLANS[profile.plan].xAccountLimit,
        settingsPath: X_KEY_SETTINGS_PATH,
      },
    });
  }

  // OAuth client を BYOK/managed で使い分ける。
  const client = await resolveClient(input.userId, authType, deps);

  const pkce = createPkce();
  const tx = newOAuthTransaction({
    userId: input.userId,
    authType,
    returnPath: input.returnPath ?? DEFAULT_RETURN_PATH,
    now: deps.now(),
    codeVerifier: pkce.codeVerifier,
    ...(input.reconnectXUserId ? { reconnectXUserId: input.reconnectXUserId } : {}),
  });
  const authorizeUrl = buildAuthorizeUrl({
    clientId: client.clientId,
    redirectUri: deps.redirectUri,
    state: tx.state,
    codeChallenge: pkce.codeChallenge,
    scopes: X_SCOPES,
  });
  return { authorizeUrl, sealedState: deps.sealState(tx), authType };
}

async function resolveClient(
  userId: string,
  authType: XAuthType,
  deps: XOAuthStartDeps,
): Promise<OAuthClient> {
  if (authType === "managed") {
    return deps.managedClient();
  }
  const creds = await deps.getByokClient(userId);
  if (!creds) {
    throw new AppError("api_key_required", {
      details: { purpose: "x", settingsPath: X_KEY_SETTINGS_PATH },
    });
  }
  return {
    clientId: creds.clientId,
    clientSecret:
      creds.clientType === "confidential" && creds.clientSecret
        ? creds.clientSecret
        : undefined,
    redirectUri: deps.redirectUri,
  };
}

import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/observability/errors";

import {
  X_SCOPES,
  type OAuthClient,
  type OAuthTransaction,
  type SealedTokens,
  type XTokenResponse,
} from "./oauth";
import {
  handleXOAuthCallback,
  type XCallbackUser,
  type XOAuthCallbackDeps,
} from "./oauth-callback";

const TX: OAuthTransaction = {
  userId: "u1",
  authType: "byok",
  returnPath: "/app/settings?tab=api-keys",
  state: "st",
  codeVerifier: "cv",
  issuedAt: 1,
};
const TOKEN: XTokenResponse = {
  access_token: "at",
  refresh_token: "rt",
  expires_in: 7200,
  scope: X_SCOPES.join(" "),
};
const USER: XCallbackUser = {
  id: "x-1",
  username: "acme",
  name: "Acme",
  profileImageUrl: null,
};
const SEALED: SealedTokens = {
  accessTokenCiphertext: "AT",
  refreshTokenCiphertext: "RT",
  tokenExpiresAt: "2026-01-01T00:00:00.000Z",
  oauthScopes: [...X_SCOPES],
};

function make(overrides: Partial<XOAuthCallbackDeps> = {}) {
  const persist = vi.fn(async () => "xa-1");
  const fetchMe = vi.fn(async () => USER);
  const exchangeCode = vi.fn(async () => TOKEN);
  const deps: XOAuthCallbackDeps = {
    verifyState: () => TX,
    resolveClient: (): OAuthClient => ({ clientId: "cid", redirectUri: "https://cb" }),
    exchangeCode,
    fetchMe,
    sealTokens: () => SEALED,
    persist,
    ...overrides,
  };
  return { deps, persist, fetchMe, exchangeCode };
}

const input = (sessionUserId: string) => ({
  code: "c",
  returnedState: "st",
  sealedStateCookie: "sealed",
  sessionUserId,
});

describe("handleXOAuthCallback", () => {
  it("happy path: exchanges, checks scopes, fetches user, persists, returns returnPath", async () => {
    const { deps, persist } = make();
    const res = await handleXOAuthCallback(input("u1"), deps);
    expect(res).toEqual({
      returnPath: "/app/settings?tab=api-keys",
      xAccountId: "xa-1",
      xUserId: "x-1",
    });
    expect(persist).toHaveBeenCalledWith({
      userId: "u1",
      authType: "byok",
      xUser: USER,
      sealed: SEALED,
    });
  });

  it("managed (premium): resolves the managed client and persists auth_type=managed", async () => {
    const managedTx: OAuthTransaction = { ...TX, authType: "managed" };
    const resolveClient = vi.fn((): OAuthClient => ({ clientId: "managed-cid", clientSecret: "sec", redirectUri: "https://cb" }));
    const { deps, persist, exchangeCode } = make({ verifyState: () => managedTx, resolveClient });
    await handleXOAuthCallback(input("u1"), deps);
    expect(resolveClient).toHaveBeenCalledWith("u1", "managed");
    // confidential client（client_secret付き）で code 交換する
    expect(exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "managed-cid", clientSecret: "sec" }),
      expect.anything(),
    );
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ authType: "managed" }));
  });

  it("rejects when the state userId does not match the session (cookie-forcing defense)", async () => {
    const { deps, persist, exchangeCode } = make();
    await expect(handleXOAuthCallback(input("someone-else"), deps)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects insufficient scope without calling /2/users/me or persisting", async () => {
    const { deps, persist, fetchMe } = make({
      exchangeCode: vi.fn(async () => ({ ...TOKEN, scope: "tweet.read users.read" })),
    });
    await expect(handleXOAuthCallback(input("u1"), deps)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(fetchMe).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not persist when /2/users/me fails", async () => {
    const { deps, persist } = make({
      fetchMe: vi.fn(async () => {
        throw new Error("me failed");
      }),
    });
    await expect(handleXOAuthCallback(input("u1"), deps)).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  });

  /**
   * 「再連携」は特定のアカウントを直す操作（T-M8-53）。
   *
   * 以前は「Xアカウントを追加」と同じURLへ飛んでいたため、**再連携を押したのに別のXアカウントで
   * 認可すると新しい行が増え、壊れた行はそのまま残った**（押した本人は直ったつもりになる）。
   */
  it("再連携で対象と同じXアカウントなら保存する（失効行が置き換わる）", async () => {
    const { deps, persist } = make({
      verifyState: () => ({ ...TX, reconnectXUserId: USER.id }),
    });
    const res = await handleXOAuthCallback(input("u1"), deps);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(res.xUserId).toBe(USER.id);
  });

  it("再連携で別のXアカウントを認可したら保存せず止める（黙って新規追加しない）", async () => {
    const { deps, persist } = make({
      verifyState: () => ({ ...TX, reconnectXUserId: "x-other" }),
    });
    await expect(handleXOAuthCallback(input("u1"), deps)).rejects.toMatchObject({
      details: { reason: "reconnect_account_mismatch", authorizedHandle: USER.username },
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("再連携の指定が無いときは従来どおり（どのアカウントでも新規連携できる）", async () => {
    const { deps, persist } = make();
    await handleXOAuthCallback(input("u1"), deps);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("propagates a verifyState failure (tampered/expired/mismatched state) without persisting", async () => {
    const { deps, persist } = make({
      verifyState: () => {
        throw new AppError("forbidden", { message: "invalid state" });
      },
    });
    await expect(handleXOAuthCallback(input("u1"), deps)).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  });
});

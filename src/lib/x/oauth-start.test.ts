import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/observability/errors";

import { X_SCOPES, type OAuthClient, type OAuthTransaction } from "./oauth";
import {
  buildXOAuthStart,
  expectedAuthTypeForPlan,
  type XOAuthStartDeps,
} from "./oauth-start";

const REDIRECT_URI = "https://app.example/api/x/oauth/callback";

function deps(overrides: Partial<XOAuthStartDeps> = {}): XOAuthStartDeps {
  return {
    getProfile: async () => ({ plan: "standard", subscriptionStatus: "active" }),
    getActiveXAccountCount: async () => 0,
    getByokClient: async () => ({
      clientId: "byok-cid",
      clientSecret: null,
      clientType: "public",
    }),
    managedClient: (): OAuthClient => ({
      clientId: "managed-cid",
      clientSecret: "managed-secret",
      redirectUri: REDIRECT_URI,
    }),
    redirectUri: REDIRECT_URI,
    sealState: (tx: OAuthTransaction) =>
      `sealed:${tx.state}:${tx.authType}:${tx.userId}:${tx.codeVerifier}`,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("expectedAuthTypeForPlan", () => {
  it("maps premium→managed and standard/md→byok", () => {
    expect(expectedAuthTypeForPlan("premium")).toBe("managed");
    expect(expectedAuthTypeForPlan("standard")).toBe("byok");
    expect(expectedAuthTypeForPlan("standard")).toBe("byok");
  });
});

describe("buildXOAuthStart", () => {
  it("byok: authorize URL has the 5 scopes + S256 PKCE and seals the state", async () => {
    const res = await buildXOAuthStart({ userId: "u1" }, deps());
    const url = new URL(res.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("byok-cid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe(X_SCOPES.join(" "));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(res.authType).toBe("byok");
    // sealed state binds userId + authType + code_verifier (returnPath handled by callback)
    expect(res.sealedState).toContain(":byok:u1:");
  });

  it("premium: uses the managed operator client", async () => {
    const res = await buildXOAuthStart(
      { userId: "u2" },
      deps({
        getProfile: async () => ({ plan: "premium", subscriptionStatus: "trialing" }),
      }),
    );
    expect(res.authType).toBe("managed");
    expect(new URL(res.authorizeUrl).searchParams.get("client_id")).toBe(
      "managed-cid",
    );
  });

  it("rejects when the subscription cannot execute", async () => {
    await expect(
      buildXOAuthStart(
        { userId: "u" },
        deps({
          getProfile: async () => ({
            plan: "standard",
            subscriptionStatus: "past_due",
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "subscription_required" });
  });

  it("byok without a saved X key → api_key_required + settings path", async () => {
    const err = await buildXOAuthStart(
      { userId: "u" },
      deps({ getByokClient: async () => null }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("api_key_required");
    expect((err as AppError).details?.settingsPath).toBe(
      "/app/settings?tab=api-keys",
    );
  });

  it("blocks a new connection when the plan X-account limit is reached", async () => {
    const err = await buildXOAuthStart(
      { userId: "u" },
      deps({ getActiveXAccountCount: async () => 3 }), // standard limit 3（T-M8-168）に到達済it = 1
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("forbidden");
    expect((err as AppError).details?.reason).toBe("x_account_limit_reached");
  });

  /**
   * 上限まで使っていても**再連携はできる**（T-M8-53）。
   * できないと「失効しているのに直す手段が無い」行き止まりになる
   * （callback 側の `assertCanLinkXAccount` も同一 `x_user_id` を上限対象外にしている）。
   */
  it("上限に達していても再連携は通す（新規ではないので数えない）", async () => {
    const count = vi.fn(async () => 1); // standard limit = 1
    const res = await buildXOAuthStart(
      { userId: "u", reconnectXUserId: "x-1" },
      deps({ getActiveXAccountCount: count }),
    );
    expect(res.authorizeUrl).toContain("state=");
    // 数えるクエリ自体を走らせない（無駄なDBアクセスも避ける）
    expect(count).not.toHaveBeenCalled();
  });

  it("再連携の対象は封緘するstateへ載る（callbackで一致を確かめられる）", async () => {
    const sealed: unknown[] = [];
    await buildXOAuthStart(
      { userId: "u", reconnectXUserId: "x-1" },
      deps({
        sealState: (tx) => {
          sealed.push(tx);
          return "sealed";
        },
      }),
    );
    expect(sealed[0]).toMatchObject({ reconnectXUserId: "x-1" });
  });

  it("never leaks a confidential client secret into the authorize URL", async () => {
    const res = await buildXOAuthStart(
      { userId: "u" },
      deps({
        getByokClient: async () => ({
          clientId: "conf-cid",
          clientSecret: "s3cr3t",
          clientType: "confidential",
        }),
      }),
    );
    expect(res.authorizeUrl).not.toContain("s3cr3t");
    expect(new URL(res.authorizeUrl).searchParams.get("client_id")).toBe(
      "conf-cid",
    );
  });
});

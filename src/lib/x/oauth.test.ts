import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { decryptWithKey, encryptWithKey } from "../crypto/envelope";
import {
  OAuthStateError,
  X_AUTHORIZE_URL,
  X_SCOPES,
  X_TOKEN_URL,
  X_REVOKE_URL,
  XTokenError,
  buildAuthorizeUrl,
  computeCodeChallenge,
  createPkce,
  exchangeCodeForToken,
  generateCodeVerifier,
  hasRequiredScopes,
  newOAuthTransaction,
  revokeOAuthToken,
  sealOAuthTransaction,
  sealTokenResponse,
  verifyOAuthCallback,
  type FetchLike,
  type FetchResponseLike,
  type OAuthClient,
} from "./oauth";

describe("PKCE (RFC 7636)", () => {
  it("matches the RFC 7636 Appendix B S256 test vector", () => {
    // verifier + expected challenge straight from RFC 7636 §Appendix B.
    expect(
      computeCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates verifiers of legal length and charset (43-128 unreserved)", () => {
    for (let i = 0; i < 20; i++) {
      const v = generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("createPkce yields a S256 challenge derived from its verifier, no padding", () => {
    const pkce = createPkce();
    expect(pkce.method).toBe("S256");
    expect(pkce.codeChallenge).toBe(computeCodeChallenge(pkce.codeVerifier));
    expect(pkce.codeChallenge).not.toContain("=");
  });
});

describe("buildAuthorizeUrl", () => {
  it("includes all params with the 5 scopes space-joined (%20) and S256", () => {
    const url = buildAuthorizeUrl({
      clientId: "byok-client",
      redirectUri: "https://app.example.com/api/x/oauth/callback",
      state: "st-123",
      codeChallenge: "chal",
    });
    expect(url.startsWith(`${X_AUTHORIZE_URL}?`)).toBe(true);
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=byok-client");
    expect(url).toContain(
      "redirect_uri=https%3A%2F%2Fapp.example.com%2Fapi%2Fx%2Foauth%2Fcallback",
    );
    expect(url).toContain(
      "scope=tweet.read%20tweet.write%20users.read%20media.write%20offline.access",
    );
    expect(url).toContain("state=st-123");
    expect(url).toContain("code_challenge=chal");
    expect(url).toContain("code_challenge_method=S256");
  });

  it("switches the App by the clientId input (BYOK vs managed)", () => {
    const base = {
      redirectUri: "https://a/cb",
      state: "s",
      codeChallenge: "c",
    };
    expect(buildAuthorizeUrl({ ...base, clientId: "user-app-id" })).toContain(
      "client_id=user-app-id",
    );
    expect(buildAuthorizeUrl({ ...base, clientId: "operator-app-id" })).toContain(
      "client_id=operator-app-id",
    );
  });
});

describe("hasRequiredScopes", () => {
  it("requires all 5 scopes to be present", () => {
    expect(hasRequiredScopes([...X_SCOPES])).toBe(true);
    expect(hasRequiredScopes([...X_SCOPES, "extra"])).toBe(true);
    expect(hasRequiredScopes(["tweet.read", "tweet.write", "users.read", "media.write"])).toBe(
      false, // missing offline.access
    );
  });
});

describe("OAuth transaction state (signed+encrypted)", () => {
  const key = randomBytes(32);

  it("round-trips and verifies a matching state within TTL", () => {
    const tx = newOAuthTransaction({
      userId: "u1",
      authType: "byok",
      returnPath: "/settings/x",
      now: 1_000_000,
      state: "state-abc",
      codeVerifier: "verifier-xyz",
    });
    const sealed = sealOAuthTransaction(tx, key);
    const out = verifyOAuthCallback(sealed, key, {
      returnedState: "state-abc",
      now: 1_000_000 + 5_000,
      maxAgeSec: 600,
    });
    expect(out).toMatchObject({
      userId: "u1",
      authType: "byok",
      returnPath: "/settings/x",
      codeVerifier: "verifier-xyz",
    });
  });

  it("rejects a mismatched state (cross-session)", () => {
    const tx = newOAuthTransaction({
      userId: "u1",
      authType: "managed",
      returnPath: "/x",
      now: 0,
      state: "real-state",
    });
    const sealed = sealOAuthTransaction(tx, key);
    expect(() =>
      verifyOAuthCallback(sealed, key, { returnedState: "attacker-state", now: 1_000 }),
    ).toThrow(OAuthStateError);
  });

  it("rejects an expired state", () => {
    const tx = newOAuthTransaction({ userId: "u1", authType: "byok", returnPath: "/", now: 0, state: "s" });
    const sealed = sealOAuthTransaction(tx, key);
    expect(() =>
      verifyOAuthCallback(sealed, key, { returnedState: "s", now: 601_000, maxAgeSec: 600 }),
    ).toThrow(/expired/);
  });

  it("rejects a tampered or missing cookie", () => {
    const tx = newOAuthTransaction({ userId: "u1", authType: "byok", returnPath: "/", now: 0, state: "s" });
    const sealed = sealOAuthTransaction(tx, key);
    const tampered = sealed.slice(0, -3) + "AAA";
    expect(() => verifyOAuthCallback(tampered, key, { returnedState: "s", now: 0 })).toThrow(
      OAuthStateError,
    );
    expect(() => verifyOAuthCallback(undefined, key, { returnedState: "s", now: 0 })).toThrow(
      /missing/,
    );
    // a cookie sealed with a different key must not open
    const otherKey = randomBytes(32);
    expect(() => verifyOAuthCallback(sealed, otherKey, { returnedState: "s", now: 0 })).toThrow(
      OAuthStateError,
    );
  });
});

describe("exchangeCodeForToken", () => {
  const ok = (json: object): FetchResponseLike => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(json),
  });

  function mockFetch(res: FetchResponseLike): {
    fetch: FetchLike;
    calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }>;
  } {
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
    const fetch: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return res;
    });
    return { fetch, calls };
  }

  const tokenJson = {
    token_type: "bearer",
    expires_in: 7200,
    access_token: "at-1",
    refresh_token: "rt-1",
    scope: "tweet.read tweet.write users.read media.write offline.access",
  };

  it("public client: client_id in body, no Basic auth", async () => {
    const { fetch, calls } = mockFetch(ok(tokenJson));
    const client: OAuthClient = { clientId: "pub-id", redirectUri: "https://a/cb" };
    const res = await exchangeCodeForToken(client, { code: "code-1", codeVerifier: "v1" }, { fetch });

    expect(res.access_token).toBe("at-1");
    expect(calls[0].url).toBe(X_TOKEN_URL);
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("redirect_uri")).toBe("https://a/cb");
    expect(body.get("code_verifier")).toBe("v1");
    expect(body.get("client_id")).toBe("pub-id");
    expect(calls[0].init.headers.authorization).toBeUndefined();
    expect(calls[0].init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
  });

  it("confidential client: Basic auth header, no client_id in body", async () => {
    const { fetch, calls } = mockFetch(ok(tokenJson));
    const client: OAuthClient = { clientId: "conf-id", clientSecret: "secret", redirectUri: "https://a/cb" };
    await exchangeCodeForToken(client, { code: "c", codeVerifier: "v" }, { fetch });

    const expected = "Basic " + Buffer.from("conf-id:secret").toString("base64");
    expect(calls[0].init.headers.authorization).toBe(expected);
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get("client_id")).toBeNull();
  });

  it("throws XTokenError with the error code on non-2xx (no token leak)", async () => {
    const { fetch } = mockFetch({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant", error_description: "bad code" }),
    });
    const client: OAuthClient = { clientId: "pub", redirectUri: "https://a/cb" };
    let err: unknown;
    await exchangeCodeForToken(client, { code: "x", codeVerifier: "v" }, { fetch }).catch((e) => (err = e));
    expect(err).toBeInstanceOf(XTokenError);
    expect((err as XTokenError).status).toBe(400);
    expect((err as XTokenError).errorCode).toBe("invalid_grant");
  });
});

describe("revokeOAuthToken", () => {
  it("posts the token and client_id as form data to the X revoke endpoint", async () => {
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
    const fetch: FetchLike = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "{}" };
    });

    await revokeOAuthToken(
      { clientId: "byok-client-id" },
      { token: "user-token" },
      { fetch },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(X_REVOKE_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(calls[0].init.body);
    expect(body.get("client_id")).toBe("byok-client-id");
    expect(body.get("token")).toBe("user-token");
  });

  it("throws a body-free error on revoke failure", async () => {
    const fetch: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => '{"detail":"must-not-leak"}',
    }));
    await expect(
      revokeOAuthToken(
        { clientId: "byok-client-id" },
        { token: "user-token" },
        { fetch },
      ),
    ).rejects.toMatchObject({ errorCode: null, status: 503 });
  });
});

describe("sealTokenResponse (AES envelope storage)", () => {
  const key = randomBytes(32);
  const enc = (s: string) => encryptWithKey(s, key);

  /**
   * 平文は**十分に長い印**を使う（2026-08-11）。
   *
   * 以前は平文が `"AT"` の2文字で、`not.toContain("AT")` により暗号化されたことを見ていた。
   * envelope は nonce/ciphertext/tag を base64 にしてJSONへ詰めるため、**乱数鍵しだいで
   * base64文字列の中にたまたま `AT` という並びが現れて落ちる**。実測 185/20000 = 0.92% で、
   * フルスイートが1%弱の確率でランダムに赤くなっていた（release ゲートも同じ確率で止まる）。
   * 印を長くすれば偶然一致は事実上消え、検査の意図（平文が残っていないこと）は変わらない。
   */
  const ACCESS_MARKER = "ACCESS_TOKEN_PLAINTEXT_MARKER";
  const REFRESH_MARKER = "REFRESH_TOKEN_PLAINTEXT_MARKER";

  it("encrypts access/refresh as envelopes recoverable by decrypt, with expiry + scopes", () => {
    const sealed = sealTokenResponse(
      {
        access_token: ACCESS_MARKER,
        refresh_token: REFRESH_MARKER,
        expires_in: 7200,
        scope: "tweet.read offline.access",
      },
      enc,
      1_000_000,
    );
    expect(decryptWithKey(sealed.accessTokenCiphertext, key)).toBe(ACCESS_MARKER);
    expect(decryptWithKey(sealed.refreshTokenCiphertext as string, key)).toBe(REFRESH_MARKER);
    // stored ciphertext, not plaintext（どちらの平文も暗号文へ現れない）
    expect(sealed.accessTokenCiphertext).not.toContain(ACCESS_MARKER);
    expect(sealed.refreshTokenCiphertext).not.toContain(REFRESH_MARKER);
    expect(sealed.tokenExpiresAt).toBe(new Date(1_000_000 + 7200 * 1000).toISOString());
    expect(sealed.oauthScopes).toEqual(["tweet.read", "offline.access"]);
  });

  it("leaves refresh ciphertext null when offline.access was not granted", () => {
    const sealed = sealTokenResponse({ access_token: "AT" }, enc, 0);
    expect(sealed.refreshTokenCiphertext).toBeNull();
    expect(sealed.tokenExpiresAt).toBeNull();
    expect(sealed.oauthScopes).toEqual([]);
  });
});

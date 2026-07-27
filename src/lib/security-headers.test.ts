import { afterEach, describe, expect, it } from "vitest";

import {
  applySecurityResponseHeaders,
  buildContentSecurityPolicy,
  generateNonce,
} from "./security-headers";

/**
 * CSP・セキュリティヘッダの構築（T-M6-17, 要件01 §8）。script-src が nonce＋strict-dynamic のみで
 * 'unsafe-inline' を含まないこと（nonceなしinline script非実行の構造的保証）、prod/devの差、HSTSの付与条件、
 * Sentry Ingest の connect-src 追加を検証する。
 */
describe("buildContentSecurityPolicy", () => {
  it("locks script-src to nonce + strict-dynamic without unsafe-inline", () => {
    const csp = buildContentSecurityPolicy("abc123", true);
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).toContain("'nonce-abc123'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'"); // nonceなしinline scriptは実行されない
    expect(scriptSrc).not.toContain("'unsafe-eval'"); // prodはeval不許可
  });

  it("hardens framing and plugins", () => {
    const csp = buildContentSecurityPolicy("n", true);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("https://challenges.cloudflare.com"); // Turnstile
  });

  it("adds unsafe-eval and drops upgrade-insecure-requests in dev", () => {
    const dev = buildContentSecurityPolicy("n", false);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
    const prod = buildContentSecurityPolicy("n", true);
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("allows the dev HMR WebSocket (ws:) in connect-src only in dev", () => {
    const dev = buildContentSecurityPolicy("n", false)
      .split("; ")
      .find((d) => d.startsWith("connect-src "))!;
    expect(dev).toContain(" ws:");
    const prod = buildContentSecurityPolicy("n", true)
      .split("; ")
      .find((d) => d.startsWith("connect-src "))!;
    expect(prod).not.toContain("ws:");
  });

  it("includes the Sentry ingest host in connect-src when a DSN is set", () => {
    const prev = process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://pub@o123.ingest.sentry.io/456";
    try {
      const connect = buildContentSecurityPolicy("n", true)
        .split("; ")
        .find((d) => d.startsWith("connect-src "))!;
      expect(connect).toContain("https://o123.ingest.sentry.io");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      else process.env.NEXT_PUBLIC_SENTRY_DSN = prev;
    }
  });
});

describe("applySecurityResponseHeaders", () => {
  it("sets CSP, nosniff, Referrer-Policy always and HSTS only in production", () => {
    const prod = new Headers();
    applySecurityResponseHeaders(prod, "csp-value", true);
    expect(prod.get("content-security-policy")).toBe("csp-value");
    expect(prod.get("x-content-type-options")).toBe("nosniff");
    expect(prod.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(prod.get("strict-transport-security")).toContain("max-age=63072000");

    const dev = new Headers();
    applySecurityResponseHeaders(dev, "csp-value", false);
    expect(dev.get("x-content-type-options")).toBe("nosniff");
    expect(dev.get("strict-transport-security")).toBeNull(); // devはHSTSなし
  });
});

describe("generateNonce", () => {
  it("returns distinct non-empty nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe("img-src と Supabase オリジン", () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  });

  it("ローカルのhttpオリジンを明示する（https: に含まれず画像が弾かれるため）", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    const csp = buildContentSecurityPolicy("n", false);
    const imgSrc = csp.split("; ").find((d) => d.startsWith("img-src")) as string;
    expect(imgSrc).toContain("http://127.0.0.1:54321");
  });

  it("本番のオリジンも明示する（https: と重複しても害はない）", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefg.supabase.co";
    const imgSrc = buildContentSecurityPolicy("n", true)
      .split("; ")
      .find((d) => d.startsWith("img-src")) as string;
    expect(imgSrc).toContain("https://abcdefg.supabase.co");
  });

  it("パス付きのURLでもオリジンだけを足す", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefg.supabase.co/rest/v1";
    const imgSrc = buildContentSecurityPolicy("n", true)
      .split("; ")
      .find((d) => d.startsWith("img-src")) as string;
    expect(imgSrc).toContain("https://abcdefg.supabase.co");
    expect(imgSrc).not.toContain("/rest/v1");
  });

  it("URLが不正・未設定でもCSPを壊さない", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    expect(buildContentSecurityPolicy("n", true)).toContain("img-src 'self' data: blob: https:;");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(buildContentSecurityPolicy("n", true)).toContain("img-src 'self' data: blob: https:;");
  });
});

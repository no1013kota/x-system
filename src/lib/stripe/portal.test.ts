import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handlePortalRequest,
  portalFlowData,
  type PortalRouteDependencies,
} from "./portal";

const APP_BASE_URL = "https://app.example.com";

function request(origin: string | null = APP_BASE_URL): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request(`${APP_BASE_URL}/api/stripe/portal`, {
    method: "POST",
    headers,
  });
}

function dependencies(
  overrides: Partial<PortalRouteDependencies> = {},
): PortalRouteDependencies {
  return {
    appBaseUrl: APP_BASE_URL,
    configurationId: "bpc_server_owned",
    getCurrentUser: vi.fn(async () => ({ id: "user_123" })),
    getProfile: vi.fn(async () => ({
      stripe_customer_id: "cus_existing",
    })),
    stripe: {
      billingPortal: {
        sessions: {
          create: vi.fn(async () => ({
            url: "https://billing.stripe.test/p/session/test_123",
          })),
        },
      },
    },
    ...overrides,
  };
}

describe("POST /api/stripe/portal core", () => {
  let deps: PortalRouteDependencies;

  beforeEach(() => {
    deps = dependencies();
  });

  it("creates a Portal Session from server-owned customer and return settings", async () => {
    const response = await handlePortalRequest(request(), deps);

    expect(response.status).toBe(200);
    expect(deps.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      configuration: "bpc_server_owned",
      customer: "cus_existing",
      return_url:
        "https://app.example.com/api/stripe/return?source=portal",
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { url: "https://billing.stripe.test/p/session/test_123" },
    });
  });

  it("omits an optional configuration in development", async () => {
    deps.configurationId = undefined;
    const response = await handlePortalRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_existing",
      return_url:
        "https://app.example.com/api/stripe/return?source=portal",
    });
  });

  it("rejects a missing or mismatched Origin before authentication", async () => {
    for (const origin of [null, "https://evil.example"]) {
      const response = await handlePortalRequest(request(origin), deps);
      expect(response.status).toBe(403);
    }
    expect(deps.getCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    deps.getCurrentUser = vi.fn(async () => null);
    const response = await handlePortalRequest(request(), deps);
    expect(response.status).toBe(401);
    expect(deps.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects profiles without a Stripe Customer", async () => {
    deps.getProfile = vi.fn(async () => ({ stripe_customer_id: null }));
    const response = await handlePortalRequest(request(), deps);
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "subscription_required",
        details: { settingsPath: "/plans" },
      },
    });
    expect(deps.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it("normalizes provider failures", async () => {
    deps.stripe.billingPortal.sessions.create = vi.fn(async () => {
      throw new Error("sk_test_secret provider body");
    });
    const response = await handlePortalRequest(request(), deps);
    expect(response.status).toBe(502);
    const body = JSON.stringify(await response.json());
    expect(body).toContain("provider_error");
    expect(body).not.toContain("sk_test_secret");
  });
});

describe("portalFlowData（やりたいことを先に選ばせる・T-M8-31）", () => {
  const RETURN_URL = "https://app.test/api/stripe/return?source=portal";

  it("プラン変更はsubscription_updateへ入る", () => {
    expect(portalFlowData("update", "sub_1", RETURN_URL)).toMatchObject({
      type: "subscription_update",
      subscription_update: { subscription: "sub_1" },
    });
  });

  it("解約はsubscription_cancelへ入る", () => {
    expect(portalFlowData("cancel", "sub_1", RETURN_URL)).toMatchObject({
      type: "subscription_cancel",
      subscription_cancel: { subscription: "sub_1" },
    });
  });

  it("完了後はアプリへ戻す（Stripeに残して迷子にしない）", () => {
    expect(portalFlowData("cancel", "sub_1", RETURN_URL)).toMatchObject({
      after_completion: { type: "redirect", redirect: { return_url: RETURN_URL } },
    });
  });

  it("**subscriptionが分からなければ組まない**（Stripeが400を返すため、Portalのトップを開く）", () => {
    expect(portalFlowData("cancel", null, RETURN_URL)).toBeUndefined();
    expect(portalFlowData("update", undefined, RETURN_URL)).toBeUndefined();
  });

  it("intent無しなら組まない（従来どおりPortalのトップ）", () => {
    expect(portalFlowData(null, "sub_1", RETURN_URL)).toBeUndefined();
  });
});

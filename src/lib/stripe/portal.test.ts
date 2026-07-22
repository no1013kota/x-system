import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handlePortalRequest,
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
        "https://app.example.com/app/settings?tab=billing&portal=return",
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
        "https://app.example.com/app/settings?tab=billing&portal=return",
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

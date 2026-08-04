import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleCheckoutRequest,
  type CheckoutRouteDependencies,
} from "./checkout";

const APP_BASE_URL = "https://app.example.com";

function request(body: unknown, origin: string | null = APP_BASE_URL): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request(`${APP_BASE_URL}/api/stripe/checkout`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<CheckoutRouteDependencies> = {},
): CheckoutRouteDependencies {
  return {
    appBaseUrl: APP_BASE_URL,
    getCurrentUser: vi.fn(async () => ({ id: "user_123", email: "user@example.com" })),
    getProfile: vi.fn(async () => ({
      stripe_customer_id: "cus_existing",
      trial_used_at: null,
    })),
    priceIds: {
      standard: "price_standard_server",
      md: "price_md_server",
      premium: "price_premium_server",
    },
    saveStripeCustomerId: vi.fn(async () => undefined),
    stripe: {
      customers: {
        create: vi.fn(async () => ({ id: "cus_created" })),
      },
      checkout: {
        sessions: {
          create: vi.fn(async () => ({
            id: "cs_test_123",
            url: "https://checkout.stripe.test/c/pay/cs_test_123",
          })),
        },
      },
    },
    ...overrides,
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/stripe/checkout core", () => {
  let deps: CheckoutRouteDependencies;

  beforeEach(() => {
    deps = dependencies();
  });

  it("rejects a missing or mismatched Origin before authentication", async () => {
    for (const origin of [null, "https://evil.example"]) {
      const response = await handleCheckoutRequest(request({ plan: "standard" }, origin), deps);
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
    expect(deps.getCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    deps.getCurrentUser = vi.fn(async () => null);
    const response = await handleCheckoutRequest(request({ plan: "standard" }), deps);
    expect(response.status).toBe(401);
    expect(await json(response)).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
  });

  it.each(["free", "STANDARD", "", null])("rejects unsupported plan %j", async (plan) => {
    const response = await handleCheckoutRequest(request({ plan }), deps);
    expect(response.status).toBe(400);
    expect(deps.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    { plan: "standard", price_id: "price_attacker" },
    { plan: "md", success_url: "https://evil.example/success" },
    { plan: "premium", return_url: "https://evil.example/return" },
  ])("rejects caller-controlled Stripe/return fields: %j", async (body) => {
    const response = await handleCheckoutRequest(request(body), deps);
    expect(response.status).toBe(400);
    expect(deps.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ["standard", "price_standard_server"],
    ["md", "price_md_server"],
    ["premium", "price_premium_server"],
  ] as const)("maps %s to its server-owned Price ID", async (plan, priceId) => {
    const response = await handleCheckoutRequest(request({ plan }), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: priceId, quantity: 1 }],
      }),
    );
  });

  it("reuses an existing Customer and adds a first-time seven-day trial", async () => {
    const response = await handleCheckoutRequest(request({ plan: "premium" }), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.customers.create).not.toHaveBeenCalled();
    expect(deps.saveStripeCustomerId).not.toHaveBeenCalled();
    expect(deps.stripe.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      locale: "ja",
      customer: "cus_existing",
      client_reference_id: "user_123",
      line_items: [{ price: "price_premium_server", quantity: 1 }],
      payment_method_collection: "always",
      success_url:
        "https://app.example.com/api/stripe/return?source=checkout&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://app.example.com/plans?checkout=canceled",
      metadata: { plan: "premium", user_id: "user_123" },
      subscription_data: {
        metadata: { plan: "premium", user_id: "user_123" },
        trial_period_days: 7,
      },
    });
    expect(await json(response)).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.test/c/pay/cs_test_123" },
    });
  });

  it("does not grant another trial after trial_used_at is set", async () => {
    deps.getProfile = vi.fn(async () => ({
      stripe_customer_id: "cus_existing",
      trial_used_at: "2026-07-01T00:00:00.000Z",
    }));
    const response = await handleCheckoutRequest(request({ plan: "standard" }), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_data: {
          metadata: { plan: "standard", user_id: "user_123" },
        },
      }),
    );
  });

  it("creates and saves a missing Customer with user metadata and an idempotency key", async () => {
    deps.getProfile = vi.fn(async () => ({
      stripe_customer_id: null,
      trial_used_at: null,
    }));
    const response = await handleCheckoutRequest(request({ plan: "md" }), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.customers.create).toHaveBeenCalledWith(
      {
        email: "user@example.com",
        metadata: { user_id: "user_123" },
      },
      { idempotencyKey: "space-ai:customer:user_123" },
    );
    expect(deps.saveStripeCustomerId).toHaveBeenCalledWith("user_123", "cus_created");
    expect(deps.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_created" }),
    );
  });

  it("normalizes Stripe failures without returning provider details", async () => {
    deps.stripe.checkout.sessions.create = vi.fn(async () => {
      throw new Error("sk_test_secret provider body");
    });
    const response = await handleCheckoutRequest(request({ plan: "standard" }), deps);
    expect(response.status).toBe(502);
    const body = JSON.stringify(await json(response));
    expect(body).toContain("provider_error");
    expect(body).not.toContain("sk_test_secret");
  });

  it("returns an internal error and does not start Checkout when Customer persistence fails", async () => {
    deps.getProfile = vi.fn(async () => ({
      stripe_customer_id: null,
      trial_used_at: null,
    }));
    deps.saveStripeCustomerId = vi.fn(async () => {
      throw new Error("database detail");
    });
    const response = await handleCheckoutRequest(request({ plan: "standard" }), deps);
    expect(response.status).toBe(500);
    expect(deps.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

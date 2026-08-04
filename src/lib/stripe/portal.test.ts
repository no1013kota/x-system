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
      subscriptions: {
        list: vi.fn(async () => ({ data: [] })),
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

/**
 * `flow_data` の subscription 解決（T-M8-56）。
 *
 * 正本（`profiles.stripe_subscription_id`）が null のとき、以前は flow_data を組まずに
 * Portal の**トップ**を開いていた。「プランを変更」を押してもプラン選択に着かず、
 * 「解約する」を押しても解約の画面に着かない——利用者が実際に踏んだ。
 */
describe("intentつきの subscription 解決", () => {
  const body = (intent: string) =>
    new Request(`${APP_BASE_URL}/api/stripe/portal`, {
      method: "POST",
      headers: new Headers({ origin: APP_BASE_URL, "content-type": "application/json" }),
      body: JSON.stringify({ intent }),
    });

  it("正本にIDがあればそれを使い、Stripeへは問い合わせない", async () => {
    const deps = dependencies({
      getProfile: vi.fn(async () => ({
        stripe_customer_id: "cus_existing",
        stripe_subscription_id: "sub_stored",
      })),
    });
    const response = await handlePortalRequest(body("update"), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.subscriptions.list).not.toHaveBeenCalled();
    const params = vi.mocked(deps.stripe.billingPortal.sessions.create).mock.calls[0][0];
    expect(params.flow_data?.type).toBe("subscription_update");
    expect(params.flow_data?.subscription_update?.subscription).toBe("sub_stored");
  });

  it("正本がnullならStripeから変更できる契約を引いて補う（webhook同期前でも正しい画面に着く）", async () => {
    const deps = dependencies({
      getProfile: vi.fn(async () => ({ stripe_customer_id: "cus_existing" })),
      stripe: {
        billingPortal: {
          sessions: {
            create: vi.fn(async () => ({ url: "https://billing.stripe.test/p/session/x" })),
          },
        },
        subscriptions: {
          // list は新しい順。canceled は対象外なので trialing が選ばれる。
          list: vi.fn(async () => ({
            data: [
              { id: "sub_canceled", status: "canceled" },
              { id: "sub_trialing", status: "trialing" },
            ],
          })),
        },
      },
    });
    const response = await handlePortalRequest(body("cancel"), deps);
    expect(response.status).toBe(200);
    const params = vi.mocked(deps.stripe.billingPortal.sessions.create).mock.calls[0][0];
    expect(params.flow_data?.type).toBe("subscription_cancel");
    expect(params.flow_data?.subscription_cancel?.subscription).toBe("sub_trialing");
  });

  it("変更できる契約が無ければ黙ってトップを開かず、理由を返す", async () => {
    const deps = dependencies({
      getProfile: vi.fn(async () => ({ stripe_customer_id: "cus_existing" })),
    });
    const response = await handlePortalRequest(body("update"), deps);
    expect(response.status).not.toBe(200);
    expect(deps.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.error.code).toBe("subscription_required");
  });

  it("intentが無ければ従来どおりトップを開く（問い合わせもしない）", async () => {
    const deps = dependencies({
      getProfile: vi.fn(async () => ({ stripe_customer_id: "cus_existing" })),
    });
    const response = await handlePortalRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.subscriptions.list).not.toHaveBeenCalled();
  });
});

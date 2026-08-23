import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleResumeRequest, type ResumeRouteDependencies } from "./resume";

/**
 * 解約済み契約の再開（T-M8-264）の中核検証。checkout/portal と同じ観点:
 * Origin最優先・未認証・前提不足の誘導・二重契約ガード・カード拒否の文言・
 * server-ownedなStripeパラメータ（price/支払い方法/冪等キー）・成功時のDB即時反映。
 */

const APP_BASE_URL = "https://app.example.com";

function request(origin: string | null = APP_BASE_URL): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request(`${APP_BASE_URL}/api/stripe/resume`, {
    method: "POST",
    headers,
  });
}

const CREATED_SUBSCRIPTION = {
  id: "sub_new",
  status: "active",
  cancel_at_period_end: false,
  cancel_at: null,
  customer: "cus_existing",
  metadata: { user_id: "6f0a2d61-58d3-4d4e-9d3b-0f6f4d9b8a10" },
  items: {
    data: [
      {
        price: { id: "price_premium" },
        current_period_end: 1_800_000_000,
      },
    ],
  },
  trial_end: null,
  trial_start: null,
  livemode: false,
} as never;

function dependencies(
  overrides: Partial<ResumeRouteDependencies> = {},
): ResumeRouteDependencies {
  return {
    appBaseUrl: APP_BASE_URL,
    applyProjection: vi.fn(async () => "updated" as const),
    getCurrentUser: vi.fn(async () => ({ id: "6f0a2d61-58d3-4d4e-9d3b-0f6f4d9b8a10" })),
    getProfile: vi.fn(async () => ({
      plan: "premium" as const,
      stripe_customer_id: "cus_existing",
    })),
    now: () => 1_790_000_000,
    priceIds: {
      standard: "price_standard",
      premium: "price_premium",
      expert: "price_expert",
    },
    stripe: {
      checkout: {
        sessions: {
          expire: vi.fn(async () => ({})),
          list: vi.fn(async () => ({ data: [] })),
        },
      },
      paymentMethods: {
        list: vi.fn(async () => ({ data: [{ id: "pm_card_1" }] })) as never,
      },
      subscriptions: {
        create: vi.fn(async () => CREATED_SUBSCRIPTION) as never,
        list: vi.fn(async () => ({ data: [] })) as never,
        retrieve: vi.fn(async () => CREATED_SUBSCRIPTION) as never,
      },
    },
    ...overrides,
  };
}

describe("POST /api/stripe/resume core", () => {
  let deps: ResumeRouteDependencies;

  beforeEach(() => {
    deps = dependencies();
  });

  it("保存済みカード・server-ownedなPrice・冪等キーで作り直し、DBへ即時反映する", async () => {
    const response = await handleResumeRequest(request(), deps);

    expect(response.status).toBe(200);
    expect(deps.stripe.subscriptions.create).toHaveBeenCalledWith(
      {
        customer: "cus_existing",
        default_payment_method: "pm_card_1",
        items: [{ price: "price_premium" }],
        metadata: { user_id: "6f0a2d61-58d3-4d4e-9d3b-0f6f4d9b8a10" },
        payment_behavior: "error_if_incomplete",
      },
      // 10分バケット = floor(1_790_000_000 / 600)。二度押しは同一作成、再試行は次バケットで新規。
      { idempotencyKey: "exos-ai:resume:cus_existing:pm_card_1:2983333" },
    );
    // webhookを待たない即時反映（billing-returnと同じ合成イベント経由）。
    expect(deps.applyProjection).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { status: "active", synced: true },
    });
  });

  it("Origin不一致は認証より先に403（他サイトからのPOSTで契約を作らせない）", async () => {
    const response = await handleResumeRequest(request("https://evil.example.com"), deps);
    expect(response.status).toBe(403);
    expect(deps.getCurrentUser).not.toHaveBeenCalled();
  });

  it("未認証は401", async () => {
    deps = dependencies({ getCurrentUser: vi.fn(async () => null) });
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(401);
  });

  it("Stripe顧客か元プランが無ければ402で/plansへ誘導（新規契約の話になる）", async () => {
    deps = dependencies({
        getProfile: vi.fn(async () => ({
        plan: null,
        stripe_customer_id: "cus_existing",
      })),
    });
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(402);
    expect(deps.stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("Stripe側に生きている契約があれば作らない（DBがcanceledでも二重契約を防ぐ・T-M8-237）", async () => {
    deps = dependencies();
    (deps.stripe.subscriptions.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ status: "active" }],
    });
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(402);
    expect(deps.stripe.subscriptions.create).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("already_subscribed");
  });

  it("カード未保存は「障害」ではなく/plansへの案内として返す", async () => {
    deps = dependencies();
    (deps.stripe.paymentMethods.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
    });
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("payment_method_missing");
    expect(deps.stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("カード拒否は直し方（カード確認・別カード）まで言う（再試行では直らない）", async () => {
    deps = dependencies();
    (deps.stripe.subscriptions.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error("Your card was declined."), { type: "StripeCardError" }),
    );
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { message: string; details: { reason: string } } };
    expect(body.error.details.reason).toBe("card_declined");
    expect(body.error.message).toContain("カード");
  });

  it("冪等リプレイで解約済みのスナップショットが返っても、成功と偽らずDBへ書かない", async () => {
    deps = dependencies();
    // create応答は「作成時active」のスナップショット、取り直した現在状態はcanceled。
    (deps.stripe.subscriptions.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...(CREATED_SUBSCRIPTION as object),
      status: "canceled",
    });
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("resume_not_confirmed");
    expect(deps.applyProjection).not.toHaveBeenCalled();
  });

  it("開いたままのCheckoutセッションをexpireする（後から完了されると2本目の契約になる）", async () => {
    deps = dependencies();
    (deps.stripe.checkout.sessions.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: "cs_open_1" }],
    });
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_open_1");
  });

  it("契約成立後のDB反映失敗は成功として返す（webhookが追いつく。契約は既に有効）", async () => {
    deps = dependencies({
      applyProjection: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const response = await handleResumeRequest(request(), deps);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { status: "active", synced: false },
    });
  });
});

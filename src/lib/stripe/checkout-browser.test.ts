import { describe, expect, it, vi } from "vitest";

import { startCheckout } from "./checkout-browser";

describe("startCheckout", () => {
  it("posts only the plan and navigates to the mocked Checkout URL", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        data: { url: "https://checkout.stripe.test/c/pay/cs_test_123" },
      }),
    );
    const navigate = vi.fn();

    await startCheckout("premium", { fetcher, navigate });

    expect(fetcher).toHaveBeenCalledWith("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "premium" }),
    });
    expect(navigate).toHaveBeenCalledWith(
      "https://checkout.stripe.test/c/pay/cs_test_123",
    );
  });

  it.each([
    ["API error", Response.json({ ok: false }, { status: 502 })],
    ["invalid JSON shape", Response.json({ ok: true, data: {} })],
    [
      "unsafe URL scheme",
      Response.json({ ok: true, data: { url: "javascript:alert(1)" } }),
    ],
  ])("does not navigate for %s", async (_label, response) => {
    const navigate = vi.fn();
    await expect(
      startCheckout("standard", {
        fetcher: vi.fn(async () => response.clone()),
        navigate,
      }),
    ).rejects.toThrow("決済画面を開けませんでした");
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * T-M8-148。**理由が分かる失敗は固定文で塗り潰さない。**
   * 2026-08-18、Stripeアカウントが本番決済を受け付けられない状態で
   * 「時間をおいてもう一度お試しください」と出続けた（待っても直らないので嘘）。
   */
  it("サーバが理由付きの文言を返したらそれを出す", async () => {
    const navigate = vi.fn();
    await expect(
      startCheckout("standard", {
        fetcher: vi.fn(async () =>
          Response.json(
            {
              ok: false,
              error: { code: "feature_disabled", message: "この機能は現在ご利用いただけません。" },
            },
            { status: 409 },
          ),
        ),
        navigate,
      }),
    ).rejects.toThrow("この機能は現在ご利用いただけません。");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("文言を取り出せないときだけ既定文へ落ちる", async () => {
    await expect(
      startCheckout("standard", {
        fetcher: vi.fn(async () => Response.json({ ok: false, error: {} }, { status: 500 })),
        navigate: vi.fn(),
      }),
    ).rejects.toThrow("決済画面を開けませんでした");
  });

  it("normalizes network failures", async () => {
    await expect(
      startCheckout("md", {
        fetcher: vi.fn(async () => {
          throw new Error("network detail");
        }),
        navigate: vi.fn(),
      }),
    ).rejects.toThrow("決済画面を開けませんでした");
  });
});

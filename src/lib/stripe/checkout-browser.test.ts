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

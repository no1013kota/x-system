import { describe, expect, it, vi } from "vitest";

import { startCustomerPortal } from "./portal-browser";

describe("startCustomerPortal", () => {
  it("posts without caller-controlled fields and navigates to HTTPS", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        data: { url: "https://billing.stripe.test/p/session/test_123" },
      }),
    );
    const navigate = vi.fn();
    await startCustomerPortal(undefined, { fetcher, navigate });
    expect(fetcher).toHaveBeenCalledWith("/api/stripe/portal", {
      method: "POST",
    });
    expect(navigate).toHaveBeenCalledWith(
      "https://billing.stripe.test/p/session/test_123",
    );
  });

  it.each([
    Response.json({ ok: false }, { status: 502 }),
    Response.json({ ok: true, data: {} }),
    Response.json({ ok: true, data: { url: "javascript:alert(1)" } }),
  ])("rejects an API error or unsafe response", async (response) => {
    const navigate = vi.fn();
    await expect(
      startCustomerPortal(undefined, {
        fetcher: vi.fn(async () => response.clone()),
        navigate,
      }),
    ).rejects.toThrow("プラン管理画面を開けませんでした");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("startCustomerPortal（やりたいことを指定する・T-M8-31）", () => {
  const okResponse = () =>
    Response.json({
      ok: true,
      data: { url: "https://billing.stripe.test/p/session/test_123" },
    });

  it.each(["update", "cancel"] as const)("intent=%s を本文へ載せる", async (intent) => {
    const fetcher = vi.fn(async () => okResponse());
    await startCustomerPortal(intent, { fetcher, navigate: vi.fn() });
    expect(fetcher).toHaveBeenCalledWith("/api/stripe/portal", {
      method: "POST",
      body: JSON.stringify({ intent }),
      headers: { "content-type": "application/json" },
    });
  });
});

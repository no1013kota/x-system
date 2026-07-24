import { describe, expect, it } from "vitest";

import { computeXAccountBanners, usageLimitBanner } from "./app-banners";
import type { UsageSummary } from "./usage/usage-summary";

const ids = (banners: { id: string }[]) => banners.map((b) => b.id);

function summary(over: Partial<Record<keyof UsageSummary, number>> = {}): UsageSummary {
  const slot = (remaining: number) => ({ used: 0, limit: 0, remaining });
  return {
    normal_posts: slot(over.normal_posts ?? 10),
    url_posts: slot(over.url_posts ?? 10),
    generations: slot(over.generations ?? 10),
    images: slot(over.images ?? 10),
  };
}

describe("computeXAccountBanners", () => {
  it("shows no X banners when accounts match the plan and are healthy", () => {
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "active", authType: "managed" }],
      xApiKeyStatus: null,
    });
    expect(banners).toEqual([]);
  });

  it("shows the auth_type re-link banner when an account's auth_type mismatches the plan", () => {
    // premium expects managed; a byok account means a plan change happened
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "expired", authType: "byok" }],
      xApiKeyStatus: null,
    });
    expect(ids(banners)).toEqual(["x_authtype"]); // mismatch takes precedence over generic expired
  });

  it("shows the connection-lost banner for expired/error accounts that still match the plan", () => {
    const banners = computeXAccountBanners({
      plan: "standard",
      xAccounts: [{ status: "expired", authType: "byok" }],
      xApiKeyStatus: "valid",
    });
    expect(ids(banners)).toEqual(["x_status"]);
  });

  it("shows the invalid-key banner for BYOK plans when the X key is invalid", () => {
    const banners = computeXAccountBanners({
      plan: "md",
      xAccounts: [{ status: "active", authType: "byok" }],
      xApiKeyStatus: "invalid",
    });
    expect(ids(banners)).toEqual(["x_key"]);
  });

  it("does not show the invalid-key banner on premium (no BYOK requirement)", () => {
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "active", authType: "managed" }],
      xApiKeyStatus: "invalid",
    });
    expect(banners).toEqual([]);
  });

  it("ignores disabled accounts for the mismatch banner", () => {
    const banners = computeXAccountBanners({
      plan: "premium",
      xAccounts: [{ status: "disabled", authType: "byok" }],
      xApiKeyStatus: null,
    });
    expect(banners).toEqual([]);
  });

  it("can surface all three X systems at once", () => {
    const banners = computeXAccountBanners({
      plan: "standard", // expects byok
      xAccounts: [
        { status: "active", authType: "managed" }, // mismatch (plan change leftover)
        { status: "expired", authType: "byok" }, // connection lost
      ],
      xApiKeyStatus: "invalid", // BYOK key invalid
    });
    expect(ids(banners)).toEqual(["x_authtype", "x_status", "x_key"]);
  });
});

describe("usageLimitBanner (T-M6-13)", () => {
  it("returns null for non-premium (summary null)", () => {
    expect(usageLimitBanner(null)).toBeNull();
  });

  it("returns null when no slot is at the limit", () => {
    expect(usageLimitBanner(summary())).toBeNull();
  });

  it("shows a warning banner naming the exhausted slots when any remaining is 0", () => {
    const banner = usageLimitBanner(summary({ url_posts: 0, images: 0 }));
    expect(banner?.id).toBe("usage_limit");
    expect(banner?.tone).toBe("warning");
    expect(banner?.description).toContain("URL付き投稿枠");
    expect(banner?.description).toContain("画像枠");
    expect(banner?.actionHref).toBe("/app/settings?tab=billing");
  });
});

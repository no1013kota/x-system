import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEWS_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
} from "./config-defaults";
import { NEWS_CATEGORIES } from "./news";
import { PLANS } from "./plans";
import { THEME_OPTIONS, themesToNewsCategories } from "./themes";

describe("plan definitions", () => {
  it("matches 要件03 §2 prices and X-account limits", () => {
    expect(PLANS.standard.monthlyPriceJpy).toBe(500);
    expect(PLANS.md.monthlyPriceJpy).toBe(1000);
    expect(PLANS.premium.monthlyPriceJpy).toBe(2980);
    expect(PLANS.standard.xAccountLimit).toBe(1);
    expect(PLANS.md.xAccountLimit).toBe(3);
    expect(PLANS.premium.xAccountLimit).toBe(3);
  });

  it("only premium has usage limits, with the documented values", () => {
    expect(PLANS.standard.usageLimits).toBeNull();
    expect(PLANS.md.usageLimits).toBeNull();
    expect(PLANS.premium.usageLimits).toEqual({
      normalPosts: 200,
      urlPosts: 20,
      generations: 100,
      images: 20,
    });
  });

  it("gates md/prompt editing to md and premium", () => {
    expect(PLANS.standard.canEditMdAndPrompts).toBe(false);
    expect(PLANS.md.canEditMdAndPrompts).toBe(true);
    expect(PLANS.premium.canEditMdAndPrompts).toBe(true);
  });
});

describe("news categories", () => {
  it("is the fixed 3 categories", () => {
    expect([...NEWS_CATEGORIES]).toEqual(["ai", "web3", "investment"]);
  });
});

describe("theme master", () => {
  it("maps every option's newsCategory to a valid category or null", () => {
    for (const t of THEME_OPTIONS) {
      if (t.newsCategory !== null) {
        expect(NEWS_CATEGORIES).toContain(t.newsCategory);
      }
    }
  });

  it("resolves theme ids to distinct news categories, ignoring unmapped/unknown", () => {
    // "business" exists but has no news category; "ai"/"web3" map
    expect(themesToNewsCategories(["ai", "web3", "business"]).sort()).toEqual([
      "ai",
      "web3",
    ]);
    // "business_ops" is unmapped, "unknown" is not in the master
    expect(themesToNewsCategories(["business_ops", "unknown"])).toEqual([]);
  });

  it("offers the confirmed 6 themes", () => {
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([
      "ai",
      "web3",
      "investment",
      "business",
      "business_ops",
      "sns",
    ]);
  });
});

describe("config defaults", () => {
  it("turns posted email off but others on (要件06 §3.4)", () => {
    expect(DEFAULT_NOTIFICATION_CONFIG.posted.email).toBe(false);
    expect(DEFAULT_NOTIFICATION_CONFIG.news.email).toBe(true);
    expect(DEFAULT_NOTIFICATION_CONFIG.error.email).toBe(true);
  });

  it("defaults news to all categories, impact high+mid, 20 items", () => {
    expect(DEFAULT_NEWS_CONFIG.categories).toEqual(["ai", "web3", "investment"]);
    expect(DEFAULT_NEWS_CONFIG.impact_filter).toEqual(["high", "mid"]);
    expect(DEFAULT_NEWS_CONFIG.max_items).toBe(20);
  });
});

import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEWS_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
} from "./config-defaults";
import { NEWS_CATEGORIES, NEWS_FETCH_CATEGORIES } from "./news";
import { PLAN_IDS, PLANS, RETENTION_DISCOUNT, hasCampaignDiscount } from "./plans";
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

  /**
   * リリース記念キャンペーン（T-M8-118）。**請求額はStripe Priceと一致していなければならない**
   * ので、`monthlyPriceJpy` を勝手に変えるとStripeとの食い違いが黙って起きる。
   * `regularPriceJpy` は「キャンペーン終了後の予定額」で、請求には使わない。
   */
  it("キャンペーン価格は請求額の2倍が終了後の額（Stripe Priceは請求額と一致）", () => {
    for (const id of PLAN_IDS) {
      const plan = PLANS[id];
      expect(plan.regularPriceJpy, `${id} の終了後価格は請求額の2倍`).toBe(
        plan.monthlyPriceJpy * 2,
      );
      expect(hasCampaignDiscount(plan), `${id} は割引中`).toBe(true);
    }
    // 終了後の額（1,000 / 2,000 / 5,960）。運営者の指示（2026-08-17）。
    expect(PLANS.standard.regularPriceJpy).toBe(1000);
    expect(PLANS.md.regularPriceJpy).toBe(2000);
    expect(PLANS.premium.regularPriceJpy).toBe(5960);
  });

  it("解約時の追加割引は50%・3ヶ月限定（プレミアムは原価を下回るため無期限にしない）", () => {
    expect(RETENTION_DISCOUNT.percentOff).toBe(50);
    expect(RETENTION_DISCOUNT.durationMonths).toBe(3);
    for (const id of PLAN_IDS) {
      expect(RETENTION_DISCOUNT.monthlyPriceJpy[id]).toBe(
        Math.round(PLANS[id].monthlyPriceJpy / 2),
      );
    }
  });

  it("only premium has usage limits, with the documented values", () => {
    expect(PLANS.standard.usageLimits).toBeNull();
    expect(PLANS.md.usageLimits).toBeNull();
    expect(PLANS.premium.usageLimits).toEqual({
      normalPosts: 200,
      urlPosts: 20,
      aiCredits: 1000,
    });
  });

  it("gates md/prompt editing to md and premium", () => {
    expect(PLANS.standard.canEditMdAndPrompts).toBe(false);
    expect(PLANS.md.canEditMdAndPrompts).toBe(true);
    expect(PLANS.premium.canEditMdAndPrompts).toBe(true);
  });
});

describe("news categories", () => {
  it("is the fixed 6 categories", () => {
    expect([...NEWS_CATEGORIES]).toEqual([
      "ai",
      "web3",
      "investment",
      "business",
      "business_ops",
      "sns",
    ]);
  });
});

describe("theme master", () => {
  it("maps every option's newsCategory to a valid category (1:1)", () => {
    for (const t of THEME_OPTIONS) {
      expect(NEWS_CATEGORIES).toContain(t.newsCategory);
    }
  });

  it("offers the confirmed 6 themes each mapped 1:1 to a news category", () => {
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([
      "ai",
      "web3",
      "investment",
      "business",
      "business_ops",
      "sns",
    ]);
    // every news category is covered exactly once
    expect(THEME_OPTIONS.map((t) => t.newsCategory).sort()).toEqual(
      [...NEWS_CATEGORIES].sort(),
    );
  });

  it("resolves theme ids to distinct news categories, ignoring unknown", () => {
    expect(themesToNewsCategories(["ai", "business"]).sort()).toEqual([
      "ai",
      "business",
    ]);
    // duplicates collapse; unknown ids are ignored
    expect(themesToNewsCategories(["ai", "ai", "unknown"])).toEqual(["ai"]);
  });
});

describe("config defaults", () => {
  it("turns posted email off but others on (要件06 §3.4)", () => {
    expect(DEFAULT_NOTIFICATION_CONFIG.posted.email).toBe(false);
    expect(DEFAULT_NOTIFICATION_CONFIG.news.email).toBe(true);
    expect(DEFAULT_NOTIFICATION_CONFIG.error.email).toBe(true);
  });

  it("既定のニュース分野は**取得している3分野**だけ（記事の来ない分野を既定にしない）", () => {
    expect(DEFAULT_NEWS_CONFIG.categories).toEqual([...NEWS_FETCH_CATEGORIES]);
    expect(DEFAULT_NEWS_CONFIG.impact_filter).toEqual(["high", "mid"]);
    expect(DEFAULT_NEWS_CONFIG.max_items).toBe(20);
  });
});

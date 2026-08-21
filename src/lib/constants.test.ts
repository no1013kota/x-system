import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEWS_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
} from "./config-defaults";
import { NEWS_CATEGORIES, NEWS_FETCH_CATEGORIES } from "./news";
import { PLAN_IDS, PLANS, RETENTION_DISCOUNT, hasCampaignDiscount } from "./plans";
import { THEME_OPTIONS, themesToNewsCategories } from "./themes";

describe("plan definitions", () => {
  // 価格は運営者の指示（2026-08-20・T-M8-168）。旧standard(¥500)は撤廃し、旧mdを「スタンダード」へ改定。
  it("matches 要件03 §2 prices and X-account limits", () => {
    expect(PLANS.standard.monthlyPriceJpy).toBe(1480);
    expect(PLANS.premium.monthlyPriceJpy).toBe(3980);
    expect(PLANS.expert.monthlyPriceJpy).toBe(14800);
    // Xアカウント上限は standard/premium=1・expertだけ3（2026-08-20運営者の指示）
    expect(PLANS.standard.xAccountLimit).toBe(1);
    expect(PLANS.premium.xAccountLimit).toBe(1);
    expect(PLANS.expert.xAccountLimit).toBe(3);
  });

  /**
   * リリース記念キャンペーン（T-M8-118）。**請求額はStripe Priceと一致していなければならない**
   * ので、`monthlyPriceJpy` を勝手に変えるとStripeとの食い違いが黙って起きる。
   *
   * **このテストが見ているのは定数どうしの関係だけで、Stripeは見ていない**（T-M8-141）。
   * 実際のPrice金額との突き合わせは `npm run doctor`（`ops/price-status.ts`）が行う。
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
    // 終了後の額（2,960 / 7,960 / 29,600）。運営者の指示（2026-08-20）。
    expect(PLANS.standard.regularPriceJpy).toBe(2960);
    expect(PLANS.premium.regularPriceJpy).toBe(7960);
    expect(PLANS.expert.regularPriceJpy).toBe(29600);
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

  it("運営キー系プランだけが利用枠を持ち、値が文書どおり", () => {
    expect(PLANS.standard.usageLimits).toBeNull();
    expect(PLANS.premium.usageLimits).toEqual({
      normalPosts: 200,
      urlPosts: 20,
      aiCredits: 1000,
    });
    // エキスパートの内部ガード（運営者の指示 2026-08-20）。**画面には出さない値**。
    expect(PLANS.expert.usageLimits).toEqual({
      normalPosts: 1000,
      urlPosts: 100,
      aiCredits: 5000,
    });
  });

  it("利用枠を隠すのはエキスパートだけ（無制限表示・T-M8-168）", () => {
    expect(PLANS.standard.concealsLimits).toBe(false);
    expect(PLANS.premium.concealsLimits).toBe(false);
    expect(PLANS.expert.concealsLimits).toBe(true);
  });

  it("md/プロンプト編集は全プラン可（旧standardの撤廃・T-M8-168）", () => {
    for (const id of PLAN_IDS) {
      expect(PLANS[id].canEditMdAndPrompts, id).toBe(true);
    }
  });
});

describe("news categories", () => {
  it("is the fixed vocabulary (運用6分野＋旧2分野・T-M8-189)", () => {
    expect([...NEWS_CATEGORIES]).toEqual([
      "ai",
      "web3",
      "investment",
      "business",
      "business_ops",
      "sns",
      "love",
      "beauty",
    ]);
  });
});

describe("theme master", () => {
  it("maps every option's newsCategory to a valid category (1:1)", () => {
    for (const t of THEME_OPTIONS) {
      expect(NEWS_CATEGORIES).toContain(t.newsCategory);
    }
  });

  it("offers the operated 6 themes first, legacy last, each mapped 1:1 to a news category", () => {
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([
      "ai",
      "web3",
      "sns",
      "investment",
      "love",
      "beauty",
      "business",
      "business_ops",
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

  it("既定のニュース分野は**取得している分野**だけ（記事の来ない分野を既定にしない）", () => {
    expect(DEFAULT_NEWS_CONFIG.categories).toEqual([...NEWS_FETCH_CATEGORIES]);
    expect(DEFAULT_NEWS_CONFIG.impact_filter).toEqual(["high", "mid"]);
  });
});

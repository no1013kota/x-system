import { describe, expect, it } from "vitest";

import {
  groupPricesByProduct,
  portalConfiguration,
  portalUpdateProducts,
} from "../../../scripts/setup-stripe-portal.mjs";

describe("Stripe Portal configuration setup", () => {
  it("pins downgrade, cancellation, trial, and upgrade proration policies", () => {
    const configuration = portalConfiguration({
      appBaseUrl: "https://app.example.com/",
      updateProducts: [
        { product: "prod_space_ai", prices: ["price_standard", "price_md", "price_premium"] },
      ],
    });

    expect(configuration.features.subscription_cancel).toEqual({
      enabled: true,
      mode: "at_period_end",
      proration_behavior: "none",
    });
    expect(configuration.features.subscription_update).toMatchObject({
      enabled: true,
      default_allowed_updates: ["price"],
      proration_behavior: "create_prorations",
      products: [
        {
          product: "prod_space_ai",
          prices: ["price_standard", "price_md", "price_premium"],
        },
      ],
      schedule_at_period_end: {
        conditions: [{ type: "decreasing_item_amount" }],
      },
      trial_update_behavior: "continue_trial",
    });
    expect(configuration.default_return_url).toBe(
      "https://app.example.com/api/stripe/return?source=portal",
    );
  });

  /**
   * **Priceが複数Productに分かれていても設定できる**（T-M8-32）。
   *
   * 以前は「同一Product配下」を要求して例外にしていた。実際のStripeアカウントでは3つのPriceが
   * 別々のProductにあり、そのため setup が止まって **`subscription_update` が無効な configuration
   * が残ったまま**になっていた（画面の「プランを変更」がStripeに拒否される）。
   */
  it("Priceを Product ごとにまとめる（同一Productを要求しない）", () => {
    expect(
      groupPricesByProduct([
        { id: "price_a", product: "prod_1" },
        { id: "price_b", product: { id: "prod_2" } },
        { id: "price_c", product: "prod_1" },
      ]),
    ).toEqual({ prod_1: ["price_a", "price_c"], prod_2: ["price_b"] });
  });

  it("Portalへ渡す形は Product ごとの配列（順序を安定させる）", () => {
    expect(portalUpdateProducts({ prod_2: ["price_b"], prod_1: ["price_c", "price_a"] })).toEqual([
      { product: "prod_1", prices: ["price_a", "price_c"] },
      { product: "prod_2", prices: ["price_b"] },
    ]);
  });
});

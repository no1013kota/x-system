import { describe, expect, it } from "vitest";

import {
  portalConfiguration,
  sharedProductId,
} from "../../../scripts/setup-stripe-portal.mjs";

describe("Stripe Portal configuration setup", () => {
  it("pins downgrade, cancellation, trial, and upgrade proration policies", () => {
    const configuration = portalConfiguration({
      appBaseUrl: "https://app.example.com/",
      priceIds: ["price_standard", "price_md", "price_premium"],
      productId: "prod_space_ai",
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
      "https://app.example.com/app/settings?tab=billing&portal=return",
    );
  });

  it("accepts only Prices from one shared Product", () => {
    expect(
      sharedProductId([
        { product: "prod_space_ai" },
        { product: { id: "prod_space_ai" } },
      ]),
    ).toBe("prod_space_ai");
    expect(() =>
      sharedProductId([
        { product: "prod_one" },
        { product: "prod_two" },
      ]),
    ).toThrow("one shared Product");
  });
});

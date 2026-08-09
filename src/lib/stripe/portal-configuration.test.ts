import { describe, expect, it } from "vitest";

import { PLANS } from "@/lib/plans";

import {
  groupPricesByProduct,
  missingEnvNames,
  portalConfiguration,
  portalUpdateProducts,
  PRODUCT_DESCRIPTIONS,
  PRODUCT_NAMES,
} from "../../../scripts/setup-stripe-portal.mjs";

describe("Stripe Portal configuration setup", () => {
  it("pins downgrade, cancellation, trial, and upgrade proration policies", () => {
    const configuration = portalConfiguration({
      appBaseUrl: "https://app.example.com/",
      updateProducts: [
        { product: "prod_exos_ai", prices: ["price_standard", "price_md", "price_premium"] },
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
          product: "prod_exos_ai",
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

/**
 * 足りない値は**まとめて**返す（T-M8-50）。
 *
 * 以前は最初に見つかった1件で止めていたため、利用者は「1つ足す → また別のが足りないと言われる」を
 * 3往復した（2026-08-04 実測。構成ID → secret key → price ID の順に1つずつ怒られた）。
 * CLAUDE.md 原則5「判断はまとめて求める」に反する。
 */
describe("missingEnvNames（足りない値をまとめて返す）", () => {
  const NAMES = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_STANDARD_MONTHLY"];

  it("接頭辞付きで足りないものを全部返す（1件で打ち切らない）", () => {
    expect(missingEnvNames(NAMES, {}, "STAGING_")).toEqual([
      "STAGING_STRIPE_SECRET_KEY",
      "STAGING_STRIPE_PRICE_STANDARD_MONTHLY",
    ]);
  });

  it("揃っていれば空", () => {
    const env = { STAGING_STRIPE_SECRET_KEY: "sk", STAGING_STRIPE_PRICE_STANDARD_MONTHLY: "price" };
    expect(missingEnvNames(NAMES, env, "STAGING_")).toEqual([]);
  });

  // **接頭辞なしの値では代用させない。** staging は別のStripeアカウントなので、
  // 手元の鍵・price を使うと `No such price` になるか、最悪別環境を書き換える。
  it("接頭辞なしの値があっても足りない扱いにする", () => {
    const env = { STRIPE_SECRET_KEY: "sk_local", STRIPE_PRICE_STANDARD_MONTHLY: "price_local" };
    expect(missingEnvNames(NAMES, env, "STAGING_")).toHaveLength(2);
  });

  it("空文字・空白だけの値は足りない扱いにする", () => {
    const env = { STAGING_STRIPE_SECRET_KEY: "   ", STAGING_STRIPE_PRICE_STANDARD_MONTHLY: "" };
    expect(missingEnvNames(NAMES, env, "STAGING_")).toHaveLength(2);
  });

  it("local（接頭辞なし）でも同じ判定ができる", () => {
    expect(missingEnvNames(NAMES, { STRIPE_SECRET_KEY: "sk" }, "")).toEqual([
      "STRIPE_PRICE_STANDARD_MONTHLY",
    ]);
  });
});

/**
 * Stripe側の商品名はアプリの表示名と同じにする（T-M8-58）。
 * Checkout・Portal・請求書にそのまま出るので、ここが英語のままだと日本語のサービスの中で
 * Stripeの画面だけ英語の商品名になる。対応表が `plans.ts` から乖離したらここで落ちる。
 */
describe("PRODUCT_NAMES はアプリの表示名と1対1", () => {
  it("standard / md / premium の表示名と一致する", () => {
    expect(PRODUCT_NAMES.STRIPE_PRICE_STANDARD_MONTHLY).toBe(PLANS.standard.displayName);
    expect(PRODUCT_NAMES.STRIPE_PRICE_MD_MONTHLY).toBe(PLANS.md.displayName);
    expect(PRODUCT_NAMES.STRIPE_PRICE_PREMIUM_MONTHLY).toBe(PLANS.premium.displayName);
  });
});

/**
 * Stripe側の商品説明はPortalの「プランを変更」画面にそのまま出る（T-M8-65）。
 * 数字（アカウント数・月間上限）を書き写しているので、`plans.ts` を変えたら
 * ここで落ちて追随を強制する。
 */
describe("PRODUCT_DESCRIPTIONS はプラン定義の数字と一致する", () => {
  it("3プランぶんの説明がある", () => {
    expect(Object.keys(PRODUCT_DESCRIPTIONS).sort()).toEqual(Object.keys(PRODUCT_NAMES).sort());
  });

  it("Xアカウント数が plans.ts と一致する", () => {
    expect(PRODUCT_DESCRIPTIONS.STRIPE_PRICE_STANDARD_MONTHLY).toContain(
      `${PLANS.standard.xAccountLimit}つのXアカウント`,
    );
    expect(PRODUCT_DESCRIPTIONS.STRIPE_PRICE_MD_MONTHLY).toContain(
      `Xアカウント${PLANS.md.xAccountLimit}つまで`,
    );
    expect(PRODUCT_DESCRIPTIONS.STRIPE_PRICE_PREMIUM_MONTHLY).toContain(
      `Xアカウント${PLANS.premium.xAccountLimit}つまで`,
    );
  });

  it("プレミアムの月間上限が plans.ts と一致する", () => {
    const limits = PLANS.premium.usageLimits;
    expect(limits).not.toBeNull();
    expect(PRODUCT_DESCRIPTIONS.STRIPE_PRICE_PREMIUM_MONTHLY).toContain(
      `通常投稿${limits?.normalPosts}・URL付き${limits?.urlPosts}・文章生成${limits?.generations}・画像${limits?.images}`,
    );
  });

  // Markdown記法はStripeの画面では描画されず、そのまま文字として出る（T-M8-55と同型）。
  it("説明に * を含めない", () => {
    for (const text of Object.values(PRODUCT_DESCRIPTIONS)) {
      expect(text).not.toContain("*");
    }
  });
});

import Stripe from "stripe";

const API_VERSION = "2026-06-24.dahlia";
const DRY_RUN = process.argv.includes("--dry-run");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function configuredPriceIds() {
  return [
    required("STRIPE_PRICE_STANDARD_MONTHLY"),
    required("STRIPE_PRICE_MD_MONTHLY"),
    required("STRIPE_PRICE_PREMIUM_MONTHLY"),
  ];
}

/**
 * Portalの `subscription_update.products` は **Product ごとの配列**（T-M8-32）。
 *
 * 以前は「3つのPriceは同一Product配下」であることを前提に1件だけ渡していた。実際のStripe
 * アカウントではPriceが3つのProductに分かれており、そのため setup が例外で止まり、
 * **`subscription_update` が無効な configuration が残ったまま**になっていた（画面の
 * 「プランを変更」を押すとStripeが拒否する）。Stripeは複数Productを列挙できるので、
 * 同一Productを要求せず**あるがままをグループ化して渡す**。
 */
export function portalUpdateProducts(pricesByProduct) {
  return Object.entries(pricesByProduct)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product, prices]) => ({ product, prices: [...prices].sort() }));
}

export function portalConfiguration({ appBaseUrl, updateProducts }) {
  const baseUrl = appBaseUrl.replace(/\/$/, "");
  return {
    name: "Space AI subscription management",
    business_profile: {
      headline: "Space AIのプランとお支払い情報を管理できます",
      privacy_policy_url: `${baseUrl}/privacy`,
      terms_of_service_url: `${baseUrl}/terms`,
    },
    default_return_url: `${baseUrl}/api/stripe/return?source=portal`,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: updateProducts,
        schedule_at_period_end: {
          conditions: [{ type: "decreasing_item_amount" }],
        },
        trial_update_behavior: "continue_trial",
      },
    },
    login_page: { enabled: false },
    metadata: { managed_by: "space-ai" },
  };
}

export function productIdOf(price) {
  return typeof price.product === "string" ? price.product : price.product.id;
}

/** Price を Product ごとにまとめる（同一Productであることは要求しない）。 */
export function groupPricesByProduct(prices) {
  const out = {};
  for (const price of prices) {
    const product = productIdOf(price);
    out[product] = [...(out[product] ?? []), price.id];
  }
  return out;
}

async function main() {
  const appBaseUrl = required("APP_BASE_URL");
  const priceIds = configuredPriceIds();

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          productResolution:
            "Retrieve the three configured Prices and require one shared Product before creation.",
          configuration: portalConfiguration({
            appBaseUrl,
            updateProducts: [{ product: "<product_from_price>", prices: priceIds }],
          }),
        },
        null,
        2,
      ),
    );
    return;
  }

  const stripe = new Stripe(required("STRIPE_SECRET_KEY"), {
    apiVersion: API_VERSION,
  });
  const prices = await Promise.all(priceIds.map((id) => stripe.prices.retrieve(id)));
  const desired = portalConfiguration({
    appBaseUrl,
    updateProducts: portalUpdateProducts(groupPricesByProduct(prices)),
  });

  // **既にIDがあるなら作り直さず更新する**（T-M8-32）。
  //
  // 以前は毎回 create していたため、走らせるたびに新しい configuration ができ、
  // env の `STRIPE_PORTAL_CONFIGURATION_ID` を人が書き換える手順が要った。書き換え漏れで
  // **古い設定を指したまま**になり、「プランを変更」が Stripe 側で無効なまま気付かなかった
  // （2026-08-03）。IDを変えなければ、env を触らずにコードと設定を一致させられる。
  const existingId = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
  const configuration = existingId
    ? await stripe.billingPortal.configurations.update(existingId, desired)
    : await stripe.billingPortal.configurations.create(desired);

  // 画面のボタンが依存する機能が本当に有効になったかを読み戻して確かめる
  // （「更新した」だけでは、送った内容が反映された保証にならない）。
  const applied = await stripe.billingPortal.configurations.retrieve(configuration.id);
  const features = {
    subscription_update: applied.features?.subscription_update?.enabled === true,
    subscription_cancel: applied.features?.subscription_cancel?.enabled === true,
  };
  const missing = Object.entries(features)
    .filter(([, enabled]) => !enabled)
    .map(([key]) => key);
  console.log(
    JSON.stringify(
      {
        configurationId: configuration.id,
        mode: existingId ? "updated-in-place" : "created",
        features,
        ...(existingId
          ? {}
          : { nextStep: "Set STRIPE_PORTAL_CONFIGURATION_ID to this ID in the target environment." }),
      },
      null,
      2,
    ),
  );
  if (missing.length > 0) {
    console.error(`Portal features still disabled after apply: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

const isEntrypoint = process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Portal setup failed.");
    process.exitCode = 1;
  });
}

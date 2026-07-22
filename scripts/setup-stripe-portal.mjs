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

export function portalConfiguration({ appBaseUrl, priceIds, productId }) {
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
        products: [{ product: productId, prices: priceIds }],
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

function productIdOf(price) {
  return typeof price.product === "string" ? price.product : price.product.id;
}

export function sharedProductId(prices) {
  const productIds = new Set(prices.map(productIdOf));
  if (productIds.size !== 1) {
    throw new Error("Configured Stripe Prices must belong to one shared Product.");
  }
  return [...productIds][0];
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
            priceIds,
            productId: "<shared_product_from_prices>",
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
  const productId = sharedProductId(prices);
  const configuration = await stripe.billingPortal.configurations.create(
    portalConfiguration({ appBaseUrl, priceIds, productId }),
  );
  console.log(
    JSON.stringify(
      {
        configurationId: configuration.id,
        nextStep: "Set STRIPE_PORTAL_CONFIGURATION_ID to this ID in the target environment.",
      },
      null,
      2,
    ),
  );
}

const isEntrypoint = process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;
if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Portal setup failed.");
    process.exitCode = 1;
  });
}

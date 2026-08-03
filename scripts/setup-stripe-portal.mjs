import Stripe from "stripe";

const API_VERSION = "2026-06-24.dahlia";
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * **どの環境を設定するかを明示させる**（T-M8-35）。
 *
 * 2026-08-04、stagingを直すつもりでこのスクリプトを実行したが、`.env.local`（＝ローカル）の
 * 値が読まれ、**ローカルの configuration を更新して「成功」と表示した**。staging は直らないまま
 * なのに出力は緑で、doctor を叩き直すまで気付けなかった。CLAUDE.md 原則1（黙って壊れない）に反する。
 *
 * 既定を持たせず、`--target` を必須にする。staging/production は環境ごとの接頭辞付き変数
 * （`STAGING_STRIPE_SECRET_KEY` など。`STAGING_CRON_SECRET` と同じ流儀）から読む。
 */
const TARGETS = ["local", "staging", "production"];
const PREFIX = { local: "", staging: "STAGING_", production: "PRODUCTION_" };

function resolveTarget() {
  const index = process.argv.indexOf("--target");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !TARGETS.includes(value)) {
    throw new Error(
      `--target <${TARGETS.join("|")}> を指定してください（どの環境のStripe設定を変えるかを間違えないため）。` +
        `例: npm run stripe:portal:setup -- --target staging`,
    );
  }
  return value;
}

/**
 * **import 時には解決しない**（T-M8-35）。この module は単体テストが
 * `portalConfiguration` を読むために import する。import で例外を投げると
 * テストファイルが1件も実行されず「no tests」と静かに緑になる（実際そうなった）。
 */
let TARGET = "local";

/**
 * 環境ごとに**必ず**分かれている値。接頭辞なしへ落とさない（取り違えると別環境を壊す）。
 * `STRIPE_PORTAL_CONFIGURATION_ID` がこれ。**どの configuration を書き換えるかを決める値**なので、
 * ここが取り違いの本体だった（2026-08-04）。
 */
function requiredPerTarget(name) {
  const prefixed = `${PREFIX[TARGET]}${name}`;
  const value = process.env[prefixed]?.trim();
  if (!value) {
    throw new Error(
      `${prefixed} is required.` +
        (PREFIX[TARGET]
          ? `（${TARGET} 用の値を .env.local へ置いてください。Vercelの環境変数からコピーします）`
          : ""),
    );
  }
  return value;
}

/**
 * 同じStripeアカウントを使う環境では共通になり得る値（secret key・price）。
 * 接頭辞付きがあればそれを使い、無ければ接頭辞なしへ落ちる。**どちらを使ったかを出力に載せる**
 * ので、黙って別環境の値を使うことはない。
 */
const sourceUsed = {};
function required(name) {
  const prefixed = `${PREFIX[TARGET]}${name}`;
  const prefixedValue = PREFIX[TARGET] ? process.env[prefixed]?.trim() : undefined;
  if (prefixedValue) {
    sourceUsed[name] = prefixed;
    return prefixedValue;
  }
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${prefixed} または ${name} is required.`);
  sourceUsed[name] = name;
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

/**
 * 対象環境のアプリURL。**`STAGING_BASE_URL` を使い回す**（デプロイ手順・doctor・smoke:live と
 * 同じ変数。同じものに2つの名前を作らない・T-M8-35）。
 */
function resolveAppBaseUrl() {
  if (TARGET === "local") return required("APP_BASE_URL");
  const name = TARGET === "staging" ? "STAGING_BASE_URL" : "PRODUCTION_BASE_URL";
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.（デプロイ手順・doctor と同じ変数です）`);
  return value;
}

async function main() {
  TARGET = DRY_RUN ? "local" : resolveTarget();
  const appBaseUrl = resolveAppBaseUrl();
  const priceIds = configuredPriceIds();

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          productResolution:
            "Retrieve the three configured Prices and group them by Product (multiple Products are allowed).",
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
  const existingId = requiredPerTarget("STRIPE_PORTAL_CONFIGURATION_ID");
  const configuration = await stripe.billingPortal.configurations.update(existingId, desired);

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
        // **どの環境を触ったかを必ず出す**（T-M8-35）。ここが無かったため、ローカルを更新して
        // 「成功」と表示し、stagingが直っていないことに気付けなかった。
        target: TARGET,
        appBaseUrl,
        configurationId: configuration.id,
        mode: "updated-in-place",
        // どの変数から値を読んだか（別環境の鍵を黙って使っていないことを確認できるように）。
        valueSources: sourceUsed,
        features,
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

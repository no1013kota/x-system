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

/** `--target` の値（未指定なら undefined）。 */
function targetArg() {
  const index = process.argv.indexOf("--target");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && TARGETS.includes(value) ? value : undefined;
}

function resolveTarget() {
  const value = targetArg();
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
 * Stripeアカウントに紐づく値。**環境ごとに別のアカウントなら全部が別物になる。**
 *
 * 2026-08-04、staging がローカルと別のStripeアカウントであることが実測で分かった
 * （手元の鍵では staging の Portal Configuration が一覧に出てこない）。当初は
 * 「price は同じアカウントなら共通」と考えて接頭辞なしへ落としていたが、その前提が崩れると
 * **staging の鍵でローカルの price を参照して `No such price` になる**。
 * アカウント単位の値は接頭辞なしへ落とさない。
 */
/**
 * Stripe側の商品名（T-M8-58）。**Checkout・Portal・請求書にそのまま出る**。
 * 英語のまま（Standard/Premium/Expert）だと、日本語で作っている画面の中でStripeの画面だけ
 * 英語の商品名になる。アプリの表示名（`src/lib/plans.ts` の displayName）と同じにする——
 * 対応が崩れていないことは `portal-configuration.test.ts` が検査する。
 */
export const PRODUCT_NAMES = {
  STRIPE_PRICE_STANDARD_MONTHLY: "スタンダードプラン",
  STRIPE_PRICE_PREMIUM_MONTHLY: "プレミアムプラン",
  STRIPE_PRICE_EXPERT_MONTHLY: "エキスパートプラン",
};

/**
 * Stripe側の商品説明（T-M8-65）。**Portalの「プランを変更」画面で商品名の下にそのまま出る**。
 * 説明が無いと、プラン変更画面には名前と金額しか出ず、何が違うのかその場で判断できない
 * （利用者の要望）。文言は `/plans` のプランカード（`src/app/plans/page.tsx`）と揃え、
 * 数字（アカウント数・月間上限）が `plans.ts` から乖離したら `portal-configuration.test.ts` が落ちる。
 */
export const PRODUCT_DESCRIPTIONS = {
  STRIPE_PRICE_STANDARD_MONTHLY:
    "Xアカウント1つ＋AIへの指示文（アカウント.md・プロンプト）を直接編集可能。キーはご自身で用意（利用料は実費）。",
  STRIPE_PRICE_PREMIUM_MONTHLY:
    "APIキーの用意が一切不要（運営キーで動作）。Xアカウント1つ。月間上限: AIクレジット1000・通常投稿200・URL付き20。",
  // エキスパートは表示上「無制限」（T-M8-168・運営者の決定）。内部ガード値をStripe画面にも出さない。
  STRIPE_PRICE_EXPERT_MONTHLY:
    "APIキーの用意が一切不要（運営キーで動作）。Xアカウント3つまで。月間の利用上限なし。",
};

const ACCOUNT_SCOPED = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_STANDARD_MONTHLY",
  "STRIPE_PRICE_PREMIUM_MONTHLY",
  "STRIPE_PRICE_EXPERT_MONTHLY",
  "STRIPE_PORTAL_CONFIGURATION_ID",
];

const sourceUsed = {};

/**
 * 足りない値を**まとめて**返す（1つずつ止めない）。
 *
 * 以前は最初に見つかった1件で例外を投げていたため、利用者は「1つ足す→また別のが足りないと言われる」
 * を3往復した（2026-08-04 実測）。CLAUDE.md 原則5「判断はまとめて求める」に反する。
 */
export function missingEnvNames(names, env, prefix) {
  return names.map((name) => `${prefix}${name}`).filter((key) => !env[key]?.trim());
}

/**
 * 構成IDだけが足りないとき、**そのアカウントの構成を一覧して候補を示す**（T-M8-50）。
 *
 * secret key があればアカウントの中は見える。構成が1件だけなら、Vercelを開かなくても
 * それが対象だと分かる（2026-08-04、staging はまさにこの状態で、既定の構成1件だけだった）。
 * 一覧は**読み取りのみ**で、候補を出すだけ——**IDの決定は人に委ねる**。ここで自動採用すると
 * T-M8-35 で防いだ「取り違えたまま成功と表示する」に戻る。
 */
async function describeConfigurationCandidates(secretKey) {
  try {
    const stripe = new Stripe(secretKey, { apiVersion: API_VERSION });
    const list = await stripe.billingPortal.configurations.list({ limit: 20 });
    if (list.data.length === 0) {
      return "\nこのStripeアカウントには Portal Configuration がまだありません。Stripe Dashboard で1つ作ってからIDを設定してください。";
    }
    const rows = list.data.map(
      (c) =>
        `  ${c.id}${c.is_default ? "（Stripeの既定）" : ""}` +
        ` プラン変更=${c.features?.subscription_update?.enabled ? "有効" : "無効"}` +
        ` 戻り先=${c.default_return_url ?? "未設定"}`,
    );
    return (
      `\nこの鍵で見える Portal Configuration は ${list.data.length} 件です:\n` +
      rows.join("\n") +
      (list.data.length === 1
        ? "\n1件だけなので、Vercelの値もこれと一致するはずです（doctorが機能名まで出せているなら、その環境はこのIDを指しています）。"
        : "\n複数あるので、どれが対象かはVercelの環境変数で確認してください（戻り先URLが手がかりになります）。")
    );
  } catch {
    return "";
  }
}

async function requireAccountScoped() {
  const prefix = PREFIX[TARGET];
  const missing = missingEnvNames(ACCOUNT_SCOPED, process.env, prefix);
  if (missing.length > 0) {
    const where =
      TARGET === "staging" ? "Preview" : TARGET === "production" ? "Production" : "ローカル";
    // 構成IDだけが足りないなら候補を出す（鍵は揃っているので一覧が引ける）。
    const onlyConfigMissing =
      missing.length === 1 && missing[0].endsWith("STRIPE_PORTAL_CONFIGURATION_ID");
    const hint = onlyConfigMissing
      ? await describeConfigurationCandidates(process.env[`${prefix}STRIPE_SECRET_KEY`].trim())
      : "";
    throw new Error(
      `${TARGET} 用のStripeの値が ${missing.length} 件足りません。Vercelの環境変数（${where}）からコピーして .env.local へ追記してください:\n` +
        missing.map((key) => `  ${key}=`).join("\n") +
        `\n\n${TARGET} は**別のStripeアカウント**なので、鍵・price・構成IDのすべてが手元とは違う値になります。` +
        `\n（コピー元の変数名は接頭辞 ${prefix} を外したものです）` +
        hint,
    );
  }
  const values = {};
  for (const name of ACCOUNT_SCOPED) {
    values[name] = process.env[`${prefix}${name}`].trim();
    sourceUsed[name] = `${prefix}${name}`;
  }
  return values;
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
    name: "Exos AI subscription management",
    business_profile: {
      headline: "Exos AIのプランとお支払い情報を管理できます",
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
    metadata: { managed_by: "exos-ai" },
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
  const name =
    TARGET === "local"
      ? "APP_BASE_URL"
      : TARGET === "staging"
        ? "STAGING_BASE_URL"
        : "PRODUCTION_BASE_URL";
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.（デプロイ手順・doctor と同じ変数です）`);
  return value;
}

async function main() {
  // `--dry-run` は通信しないので `--target` 省略を許すが、**指定されたら尊重する**（T-M8-51）。
  TARGET = DRY_RUN ? (targetArg() ?? "local") : resolveTarget();
  const appBaseUrl = resolveAppBaseUrl();
  const account = await requireAccountScoped();
  const priceIds = [
    account.STRIPE_PRICE_STANDARD_MONTHLY,
    account.STRIPE_PRICE_EXPERT_MONTHLY,
    account.STRIPE_PRICE_PREMIUM_MONTHLY,
  ];

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          // **どの環境の下書きかを出す**（T-M8-51）。以前は `--target` を黙って無視して常に
          // ローカルの値で表示していたため、`--dry-run --target staging` の出力を
          // staging の内容だと誤解できた。
          target: TARGET,
          appBaseUrl,
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

  const stripe = new Stripe(account.STRIPE_SECRET_KEY, { apiVersion: API_VERSION });

  // 商品名・説明をアプリの表示へ揃える（違うときだけ更新。何度実行しても同じ結果）。
  const renamed = [];
  const described = [];
  for (const [envName, name] of Object.entries(PRODUCT_NAMES)) {
    const price = await stripe.prices.retrieve(account[envName], { expand: ["product"] });
    const product = price.product;
    if (typeof product === "string" || product.deleted) continue;
    const description = PRODUCT_DESCRIPTIONS[envName];
    const patch = {};
    if (product.name !== name) patch.name = name;
    if (product.description !== description) patch.description = description;
    if (Object.keys(patch).length > 0) {
      await stripe.products.update(product.id, patch);
      if (patch.name) renamed.push(`${product.name} → ${name}`);
      if (patch.description) described.push(name);
    }
  }
  // **`No such price` を運営者に分かる言葉へ変える。** 生のStripeエラーだけだと、
  // 「別アカウントの鍵で手元のprice IDを参照した」ことが読み取れない（2026-08-04 に実際に踏んだ）。
  const prices = await Promise.all(
    priceIds.map((id) =>
      stripe.prices.retrieve(id).catch((error) => {
        throw new Error(
          `price ${id} が ${TARGET} のStripeアカウントに見つかりません。` +
            `${PREFIX[TARGET]}STRIPE_PRICE_* が ${TARGET} 側の値になっているか確認してください` +
            `（別アカウントなので手元の price ID は使えません）。元のエラー: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }),
    ),
  );
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
  const existingId = account.STRIPE_PORTAL_CONFIGURATION_ID;
  const configuration = await stripe.billingPortal.configurations.update(existingId, desired);

  /*
    画面のボタンが依存する機能が本当に有効になったかを読み戻して確かめる
    （「更新した」だけでは、送った内容が反映された保証にならない）。

    **`enabled` だけでは足りない**（T-M8-238）。2026-08-23の監査で、本番・stagingとも
    `enabled=true` のまま**変更先のPriceが旧価格のまま**になっていた（＝契約者は
    「プランを変更」を開けない）。金額と時期を決めるのは `products` と
    `trial_update_behavior` なので、そこまで読み戻して一致を確かめる。
    **`products` は expand しないと返らない**（素のGETでは undefined）。
  */
  const applied = await stripe.billingPortal.configurations.retrieve(configuration.id, {
    expand: ["features.subscription_update.products"],
  });
  const features = {
    subscription_update: applied.features?.subscription_update?.enabled === true,
    subscription_cancel: applied.features?.subscription_cancel?.enabled === true,
  };
  const missing = Object.entries(features)
    .filter(([, enabled]) => !enabled)
    .map(([key]) => key);

  // 送った Price がすべて変更先に載ったか（載っていなければ「成功」と言ってはいけない）。
  const appliedPriceIds = new Set(
    (applied.features?.subscription_update?.products ?? []).flatMap((entry) => entry.prices),
  );
  const missingPrices = priceIds.filter((id) => !appliedPriceIds.has(id));
  const appliedTrialBehavior = applied.features?.subscription_update?.trial_update_behavior ?? null;
  const desiredTrialBehavior = desired.features.subscription_update.trial_update_behavior;
  const trialBehaviorOk = appliedTrialBehavior === desiredTrialBehavior;
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
        productNames: renamed.length > 0 ? renamed : "既に揃っています",
        productDescriptions: described.length > 0 ? `更新: ${described.join("・")}` : "既に揃っています",
        features,
        // 変更先に載った Price と、トライアル中の変更挙動（doctorが見るのと同じ2点）。
        planChangePrices:
          missingPrices.length === 0
            ? `現行 ${priceIds.length} プランすべてが変更先に入っています`
            : `不足 ${missingPrices.length}/${priceIds.length} 件: ${missingPrices.join(", ")}`,
        trialUpdateBehavior: appliedTrialBehavior,
      },
      null,
      2,
    ),
  );
  if (missing.length > 0) {
    console.error(`Portal features still disabled after apply: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
  if (missingPrices.length > 0) {
    console.error(
      `変更先に載らなかった Price があります: ${missingPrices.join(", ")}。` +
        `契約者は「プランを変更」を開けません（Stripeダッシュボードで確認してください）`,
    );
    process.exitCode = 1;
  }
  if (!trialBehaviorOk) {
    console.error(
      `トライアル中の変更挙動が ${appliedTrialBehavior} のままです（期待: ${desiredTrialBehavior}）。` +
        `このままだとトライアル中にプラン変更すると即時課金されます`,
    );
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

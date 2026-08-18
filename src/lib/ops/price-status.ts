import { PLAN_IDS, PLANS, type PlanId } from "@/lib/plans";

import type { Check } from "./check";

/**
 * **アプリが表示する月額と、Stripeが実際に請求する金額が一致しているか**（T-M8-141）。
 *
 * `plans.ts` のコメントは「Stripe Price の金額と必ず一致させる（`constants.test.ts` が
 * 突き合わせる）」と書いていたが、**そのテストは定数とリテラルを比べるだけでStripeを見ていない**。
 * つまり請求額と表示額のズレを誰も検出していなかった（CLAUDE.md 原則4「費用が見える」に反する）。
 *
 * ズレると「画面は1,000円と言うのに2,000円請求される」という、
 * 利用者からの申告でしか気付けない事故になる。
 */

/** Stripe Price の取得だけを使う最小の入口（テストから差し替えるため注入する）。 */
export interface PriceGateway {
  prices: {
    retrieve(id: string): Promise<{ unit_amount: number | null; currency: string; active?: boolean }>;
  };
}

export interface PriceProbeDeps {
  /** planId → Stripe Price ID。未設定のplanは検査対象外（環境差があるため）。 */
  priceIds?: Partial<Record<PlanId, string | undefined>>;
  stripe?: PriceGateway | null;
}

export interface PriceSnapshot {
  /** planId → 実測。取得できなかったものは入れない。 */
  actual: Partial<Record<PlanId, { amount: number | null; currency: string; active: boolean }>>;
  /** Stripeへ届かなかった（鍵が無い・通信不能）。判定を「不明」にする。 */
  unavailable?: boolean;
  /** Price IDが1つも設定されていない。 */
  noPriceIds?: boolean;
  error?: string;
}

export async function probePrices(deps: PriceProbeDeps): Promise<PriceSnapshot> {
  const ids = deps.priceIds ?? {};
  const configured = PLAN_IDS.filter((id) => ids[id]);
  if (configured.length === 0) return { actual: {}, noPriceIds: true };
  if (!deps.stripe) return { actual: {}, unavailable: true };
  const actual: PriceSnapshot["actual"] = {};
  try {
    for (const id of configured) {
      const price = await deps.stripe.prices.retrieve(ids[id] as string);
      actual[id] = {
        amount: price.unit_amount,
        currency: price.currency,
        active: price.active !== false,
      };
    }
  } catch (error) {
    // **「届かない」と「金額が違う」を区別する**。前者で赤くすると赤の常態化を招く。
    return { actual, unavailable: true, error: String((error as Error).message).slice(0, 80) };
  }
  return { actual };
}

export const PRICE_CHECK_NAME = "請求額と表示額の一致（Stripe）";

export function judgePrices(snapshot: PriceSnapshot): Check {
  if (snapshot.noPriceIds) {
    return {
      name: PRICE_CHECK_NAME,
      level: "warn",
      detail: "Stripe Price IDが未設定のため確認できません",
      nextAction: "`STRIPE_PRICE_STANDARD_MONTHLY` 等を設定すると請求額を突き合わせます",
    };
  }
  if (snapshot.unavailable) {
    return {
      name: PRICE_CHECK_NAME,
      level: "warn",
      detail: `Stripeへ問い合わせできません${snapshot.error ? `（${snapshot.error}）` : ""}`,
      nextAction: "`STRIPE_SECRET_KEY` を設定すると請求額を突き合わせます",
    };
  }

  const mismatches: string[] = [];
  const inactive: string[] = [];
  const checked: string[] = [];
  for (const id of PLAN_IDS) {
    const got = snapshot.actual[id];
    if (!got) continue;
    const want = PLANS[id].monthlyPriceJpy;
    checked.push(`${PLANS[id].displayName} ¥${got.amount ?? "?"}`);
    // 円は最小単位が1なので `unit_amount` がそのまま円。通貨が違えば桁の意味が変わる。
    if (got.currency !== "jpy") {
      mismatches.push(`${PLANS[id].displayName}: 通貨が ${got.currency}（jpy であるべき）`);
    } else if (got.amount !== want) {
      mismatches.push(`${PLANS[id].displayName}: Stripe ¥${got.amount ?? "未設定"} ≠ 画面 ¥${want}`);
    }
    if (!got.active) inactive.push(PLANS[id].displayName);
  }

  if (checked.length === 0) {
    return {
      name: PRICE_CHECK_NAME,
      level: "warn",
      detail: "突き合わせた価格がありません",
      nextAction: "Stripe Price IDの設定を確認してください",
    };
  }
  if (mismatches.length > 0) {
    return {
      name: PRICE_CHECK_NAME,
      level: "error",
      detail:
        `**画面の金額とStripeの請求額が違います**（${mismatches.join(" / ")}）。` +
        "利用者からの申告でしか気付けない事故になります",
      nextAction:
        "Stripeの価格を直すか、`src/lib/plans.ts` の `monthlyPriceJpy` を実際の請求額へ合わせてください",
    };
  }
  if (inactive.length > 0) {
    return {
      name: PRICE_CHECK_NAME,
      level: "error",
      detail: `金額は一致していますが、無効な価格があります（${inactive.join("・")}）。新規登録が失敗します`,
      nextAction: "Stripeダッシュボードでその価格を有効にしてください",
    };
  }
  return { name: PRICE_CHECK_NAME, level: "ok", detail: `一致しています（${checked.join(" / ")}）` };
}

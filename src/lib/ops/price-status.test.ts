import { describe, expect, it } from "vitest";

import { PLANS } from "@/lib/plans";

import { PRICE_CHECK_NAME, judgePrices, probePrices, type PriceGateway } from "./price-status";

/**
 * T-M8-141。**請求額と表示額のズレを検出する。**
 *
 * `plans.ts` は「Stripe Price の金額と必ず一致させる（`constants.test.ts` が突き合わせる）」と
 * 書いていたが、そのテストは定数とリテラルを比べるだけでStripeを見ていなかった。
 * ズレると「画面は1,000円と言うのに2,000円請求される」という、
 * 利用者の申告でしか気付けない事故になる（CLAUDE.md 原則4）。
 */
const IDS = { standard: "price_s", premium: "price_p", expert: "price_i" } as const;

function gateway(
  amounts: Partial<Record<string, { unit_amount: number | null; currency?: string; active?: boolean }>>,
): PriceGateway {
  return {
    prices: {
      async retrieve(id) {
        const row = amounts[id];
        if (!row) throw new Error(`no such price: ${id}`);
        return { unit_amount: row.unit_amount, currency: row.currency ?? "jpy", active: row.active };
      },
    },
  };
}

describe("請求額と表示額の一致（T-M8-141）", () => {
  it("一致していれば ok（金額を必ず出す）", async () => {
    const snap = await probePrices({
      priceIds: IDS,
      stripe: gateway({
        price_s: { unit_amount: PLANS.standard.monthlyPriceJpy },
        price_i: { unit_amount: PLANS.expert.monthlyPriceJpy },
        price_p: { unit_amount: PLANS.premium.monthlyPriceJpy },
      }),
    });
    const check = judgePrices(snap);
    expect(check.name).toBe(PRICE_CHECK_NAME);
    expect(check.level).toBe("ok");
    // 「問題なし」だけにしない（実際の金額を出す）。
    expect(check.detail).toContain(`¥${PLANS.expert.monthlyPriceJpy}`);
  });

  it("1つでも違えば error にして、どちらがいくらかを言う", async () => {
    const snap = await probePrices({
      priceIds: IDS,
      stripe: gateway({
        price_s: { unit_amount: PLANS.standard.monthlyPriceJpy },
        price_i: { unit_amount: PLANS.expert.monthlyPriceJpy * 2 }, // キャンペーン解除の取り違え
        price_p: { unit_amount: PLANS.premium.monthlyPriceJpy },
      }),
    });
    const check = judgePrices(snap);
    expect(check.level).toBe("error");
    expect(check.detail).toContain(PLANS.expert.displayName);
    expect(check.detail).toContain(`¥${PLANS.expert.monthlyPriceJpy * 2}`);
    expect(check.detail).toContain(`¥${PLANS.expert.monthlyPriceJpy}`);
    expect(check.nextAction).toContain("monthlyPriceJpy");
  });

  it("通貨が違えば error（桁の意味が変わる）", async () => {
    const snap = await probePrices({
      priceIds: { expert: "price_i" },
      stripe: gateway({ price_i: { unit_amount: PLANS.expert.monthlyPriceJpy, currency: "usd" } }),
    });
    expect(judgePrices(snap).level).toBe("error");
    expect(judgePrices(snap).detail).toContain("usd");
  });

  it("金額が合っていても無効な価格なら error（新規登録が失敗する）", async () => {
    const snap = await probePrices({
      priceIds: { expert: "price_i" },
      stripe: gateway({ price_i: { unit_amount: PLANS.expert.monthlyPriceJpy, active: false } }),
    });
    const check = judgePrices(snap);
    expect(check.level).toBe("error");
    expect(check.detail).toContain("無効な価格");
  });

  it("鍵が無い・届かないは warn（赤の常態化を避ける）", async () => {
    expect(judgePrices(await probePrices({ priceIds: IDS, stripe: null })).level).toBe("warn");
    const failing: PriceGateway = {
      prices: {
        async retrieve() {
          throw new Error("network down");
        },
      },
    };
    const check = judgePrices(await probePrices({ priceIds: IDS, stripe: failing }));
    expect(check.level, "届かないのは error にしない").toBe("warn");
    expect(check.detail).toContain("network down");
  });

  it("Price IDが未設定なら warn（環境差があるため赤くしない）", async () => {
    const check = judgePrices(await probePrices({ priceIds: {}, stripe: gateway({}) }));
    expect(check.level).toBe("warn");
    expect(check.nextAction).toContain("STRIPE_PRICE_STANDARD_MONTHLY");
  });
});

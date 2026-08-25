import { describe, expect, it } from "vitest";

import { PLANS } from "@/lib/plans";

import { discountLabel } from "./discount-label";

/** 割引の表示（T-M8-279）。「いつまで・いくら」を1行で出す。数字は PLANS から計算する。 */
describe("discountLabel", () => {
  it("率の割引: 割引後の月額と終了日を出す（半額クーポン）", () => {
    const label = discountLabel({
      plan: "premium",
      discount_percent_off: 50,
      discount_amount_off_jpy: null,
      discount_ends_at: "2026-11-22T15:00:00Z",
    });
    expect(label).toBe(
      `50%割引適用中（2026年11月23日まで 月額 ¥${(PLANS.premium.monthlyPriceJpy / 2).toLocaleString("ja-JP")}）`,
    );
  });

  it("額の割引と、終了日が無い割引（ずっと適用）", () => {
    expect(
      discountLabel({ plan: "standard", discount_percent_off: null, discount_amount_off_jpy: 480, discount_ends_at: null }),
    ).toBe("¥480割引適用中（月額 ¥1,000）");
  });

  it("割引が無い・プランが無い・日付が壊れているときは日付を作らない", () => {
    expect(
      discountLabel({ plan: "premium", discount_percent_off: null, discount_amount_off_jpy: null, discount_ends_at: null }),
    ).toBeNull();
    expect(
      discountLabel({ plan: null, discount_percent_off: 50, discount_amount_off_jpy: null, discount_ends_at: null }),
    ).toBeNull();
    expect(
      discountLabel({ plan: "premium", discount_percent_off: 50, discount_amount_off_jpy: null, discount_ends_at: "not-a-date" }),
    ).toBe("50%割引適用中（月額 ¥1,990）");
  });
});

import { describe, expect, it } from "vitest";

import { PLANS, RETENTION_DISCOUNT } from "@/lib/plans";

import { applyDiscount, discountedMonthlyJpy, isDiscountActive } from "./discounted-price";

/** 割引後の月額（D-55(1)・2026-09-04）。MRRと契約者向け表示の両方がこの計算を使う。 */
describe("applyDiscount", () => {
  it("率の割引: 引き止めクーポン（50%）は RETENTION_DISCOUNT の記録値と一致する", () => {
    for (const plan of Object.values(PLANS)) {
      expect(applyDiscount(plan.monthlyPriceJpy, RETENTION_DISCOUNT.percentOff, null)).toBe(
        RETENTION_DISCOUNT.monthlyPriceJpy[plan.id],
      );
    }
  });

  it("率は四捨五入、額は引き算、どちらも下限0", () => {
    expect(applyDiscount(1001, 33, null)).toBe(671); // 670.67 → 671
    expect(applyDiscount(1000, 100, null)).toBe(0);
    expect(applyDiscount(1000, null, 480)).toBe(520);
    expect(applyDiscount(1000, null, 5000)).toBe(0);
  });

  it("率と額の両方があるときは率を先に見る（discount-label と同じ順）", () => {
    expect(applyDiscount(1000, 50, 480)).toBe(500);
  });

  it("割引が無い（null・0）ときは定価のまま", () => {
    expect(applyDiscount(1000, null, null)).toBe(1000);
    expect(applyDiscount(1000, 0, 0)).toBe(1000);
    expect(applyDiscount(1000, undefined, undefined)).toBe(1000);
  });
});

describe("isDiscountActive", () => {
  const now = "2026-09-04T00:00:00Z";
  it("終了日なし（null）はずっと有効", () => {
    expect(isDiscountActive(null, now)).toBe(true);
    expect(isDiscountActive(undefined, now)).toBe(true);
  });
  it("終了日が未来なら有効、過去・同時刻なら無効", () => {
    expect(isDiscountActive("2026-09-04T00:00:01Z", now)).toBe(true);
    expect(isDiscountActive(new Date("2026-12-01T00:00:00Z"), new Date(now))).toBe(true);
    expect(isDiscountActive("2026-09-03T23:59:59Z", now)).toBe(false);
    expect(isDiscountActive(now, now)).toBe(false);
  });
  it("壊れた日付は「掛けない」側に倒す", () => {
    expect(isDiscountActive("not-a-date", now)).toBe(false);
  });
});

describe("discountedMonthlyJpy", () => {
  const price = PLANS.premium.monthlyPriceJpy;
  it("有効な割引だけを掛ける", () => {
    expect(
      discountedMonthlyJpy({
        monthlyPriceJpy: price,
        percentOff: 50,
        amountOffJpy: null,
        discountEndsAt: "2026-11-22T15:00:00Z",
        now: "2026-09-04T00:00:00Z",
      }),
    ).toBe(price / 2);
    expect(
      discountedMonthlyJpy({
        monthlyPriceJpy: price,
        percentOff: 50,
        amountOffJpy: null,
        discountEndsAt: "2026-08-01T00:00:00Z",
        now: "2026-09-04T00:00:00Z",
      }),
    ).toBe(price);
    expect(
      discountedMonthlyJpy({
        monthlyPriceJpy: price,
        percentOff: null,
        amountOffJpy: null,
        discountEndsAt: null,
        now: "2026-09-04T00:00:00Z",
      }),
    ).toBe(price);
  });
});

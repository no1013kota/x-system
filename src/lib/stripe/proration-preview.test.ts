import { describe, expect, it, vi } from "vitest";

import { loadPendingProration, prorationNotice } from "./proration-preview";

/**
 * プラン変更で発生した日割り差額の下見（T-M8-270）。Stripeの確認画面には独自の文章を書けないので、
 * 「確定」直後に戻ってきた画面で実際の差額を出す。
 */
function preview(lines: unknown[], over: object = {}) {
  return {
    invoices: {
      createPreview: vi.fn(async () => ({
        lines: { data: lines },
        next_payment_attempt: 1_790_000_000,
        ...over,
      })),
    },
  } as never;
}
const line = (amount: number, proration: boolean) => ({
  amount,
  parent: { subscription_item_details: { proration } },
});
const input = { customerId: "cus_1", subscriptionId: "sub_1" };

describe("loadPendingProration", () => {
  it("日割り行だけを合計する（通常の月額行は数えない）", async () => {
    const result = await loadPendingProration(
      preview([line(-1_480, true), line(3_980, true), line(3_980, false)]),
      input,
    );
    expect(result).toEqual({ amountJpy: 2_500, chargedAt: "2026-09-21T14:13:20.000Z" });
  });

  it("日割りが無い（下位変更の予約・通常の更新）なら null", async () => {
    expect(await loadPendingProration(preview([line(3_980, false)]), input)).toBeNull();
    // 返金方向（合計がマイナス）も出さない——「加算されます」と食い違う。
    expect(await loadPendingProration(preview([line(-500, true)]), input)).toBeNull();
  });

  it("Stripeが落ちても画面は止めない（null を返す）", async () => {
    const stripe = {
      invoices: {
        createPreview: vi.fn(async () => {
          throw new Error("stripe down");
        }),
      },
    } as never;
    expect(await loadPendingProration(stripe, input)).toBeNull();
  });

  it("請求日が取れなければ period_end を使い、どちらも無ければ日付を作らない", async () => {
    const withPeriod = await loadPendingProration(
      preview([line(2_500, true)], { next_payment_attempt: null, period_end: 1_790_000_000 }),
      input,
    );
    expect(withPeriod?.chargedAt).toBe("2026-09-21T14:13:20.000Z");
    const without = await loadPendingProration(
      preview([line(2_500, true)], { next_payment_attempt: null, period_end: null }),
      input,
    );
    expect(without).toEqual({ amountJpy: 2_500, chargedAt: null });
  });
});

describe("prorationNotice", () => {
  it("金額と加算先の請求日をJSTで出す", () => {
    expect(prorationNotice({ amountJpy: 2_500, chargedAt: "2026-09-22T15:00:00Z" })).toBe(
      "変更前後の料金を日割りで計算した差額 ¥2,500 は、次回のご請求（2026年9月23日）に加算されます。",
    );
  });

  it("日付が無い・壊れていれば存在しない日付を作らない", () => {
    for (const chargedAt of [null, "not-a-date"]) {
      expect(prorationNotice({ amountJpy: 2_500, chargedAt })).toBe(
        "変更前後の料金を日割りで計算した差額 ¥2,500 は、次回のご請求に加算されます。",
      );
    }
  });
});

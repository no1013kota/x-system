/**
 * 割引後の月額（引き止めクーポンの反映・運営者の決定 2026-09-04・D-55(1)）。
 *
 * `profiles.discount_*` はStripeの契約に付いたクーポンの写し（`subscription-sync.ts` の `loadDiscount`）。
 * Stripeのクーポンは `percent_off` か `amount_off` の**どちらか一方**を持つ（両方は作れない）ので、
 * 両方が入っていても率を先に見る——契約者に見せている `discount-label.ts` と同じ順にして、
 * 「契約者の画面の月額」と「運営者の /admin のMRR」が食い違わないようにする。
 *
 * 使うのは2か所。
 * - 契約者向けの表示（`discountLabel`）: 期限は見ない（同期が切れた割引を消すので、写しにあるものをそのまま出す）
 * - /admin のMRR（`ops/kpi.ts`）: **期限を見る**。`discount_ends_at` を過ぎた割引は
 *   webhookが届く前でも掛けない（届かなければ写しが残り続けるため）
 *
 * 写しの制約（T-M8-279 由来・ここでは直さない）: 契約に付いた割引の**先頭1件だけ**を写し、
 * `coupon.duration` は写さない。`duration=once` のクーポンも Stripe では `end` が null なので、
 * 次の請求書が確定して契約同期が写しを消すまで「ずっと適用」として掛かる。引き止めクーポンは
 * `repeating`（3か月）1件なので現行運用では起きない。
 */

/**
 * 割引の算術だけ（有効期限は見ない）。
 *
 * **円の丸めは四捨五入**。Stripeが `percent_off` を最小通貨単位（円）へどう丸めるかは
 * 公式ドキュメントに明記が無く（2026-09-04 に確認）、契約者へ見せている `discount-label.ts` が
 * 元から四捨五入だったのでそれに揃える。いまの価格（1,480／3,980／14,800円）× 引き止め50%は
 * 割り切れるため、実際には丸めが起きない。起きても1契約あたり最大1円の差。
 */
export function applyDiscount(
  monthlyPriceJpy: number,
  percentOff: number | null | undefined,
  amountOffJpy: number | null | undefined,
): number {
  if (percentOff && percentOff > 0) {
    return Math.max(0, Math.round(monthlyPriceJpy * (1 - Math.min(percentOff, 100) / 100)));
  }
  if (amountOffJpy && amountOffJpy > 0) {
    return Math.max(0, monthlyPriceJpy - amountOffJpy);
  }
  return monthlyPriceJpy;
}

/**
 * 割引がその時点で有効か。`discountEndsAt` が null は「終了日なし（ずっと適用）」（migration
 * 20260823000012 の列コメント）。壊れた日付は「期限を確かめられない」ので**掛けない**側に倒す
 * （MRRを多く見せるより少なく見せる方が運営判断として安全）。
 */
export function isDiscountActive(
  discountEndsAt: string | Date | null | undefined,
  now: string | Date,
): boolean {
  if (discountEndsAt == null) return true;
  const ends = discountEndsAt instanceof Date ? discountEndsAt : new Date(discountEndsAt);
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(ends.getTime()) || Number.isNaN(at.getTime())) return false;
  return ends.getTime() > at.getTime();
}

export interface DiscountedMonthlyInput {
  monthlyPriceJpy: number;
  percentOff: number | null | undefined;
  amountOffJpy: number | null | undefined;
  discountEndsAt: string | Date | null | undefined;
  now: string | Date;
}

/** 有効な割引だけを掛けた月額（円・下限0）。 */
export function discountedMonthlyJpy(input: DiscountedMonthlyInput): number {
  if (!isDiscountActive(input.discountEndsAt, input.now)) return input.monthlyPriceJpy;
  return applyDiscount(input.monthlyPriceJpy, input.percentOff, input.amountOffJpy);
}

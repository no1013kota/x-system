import { PLANS, type PlanId } from "@/lib/plans";

/**
 * 適用中の割引の表示（T-M8-279・運営者の指示 2026-08-23）。
 *
 * 解約の引き止めクーポン（半額・3か月）を受け取っても**画面のどこにも出ていなかった**。
 * 契約者がいちばん知りたいのは「次にいくら払うのか」なので、プラン名の下にそれを出す。
 * 数字は `PLANS` の月額から計算する（画面へ書き写さない）。
 */

export interface DiscountProfile {
  plan: PlanId | null;
  discount_percent_off: number | null;
  discount_amount_off_jpy: number | null;
  discount_ends_at: string | Date | null;
}

export function discountLabel(profile: DiscountProfile): string | null {
  const plan = profile.plan ? PLANS[profile.plan] : null;
  if (!plan) return null;
  const percent = profile.discount_percent_off;
  const amount = profile.discount_amount_off_jpy;
  if (!percent && !amount) return null;

  const discounted = percent
    ? Math.round(plan.monthlyPriceJpy * (1 - percent / 100))
    : Math.max(0, plan.monthlyPriceJpy - (amount ?? 0));
  const yen = (value: number) => new Intl.NumberFormat("ja-JP").format(value);
  const rate = percent ? `${percent}%割引` : `¥${yen(amount ?? 0)}割引`;
  const until = untilLabel(profile.discount_ends_at);
  // 「いつまで・いくら」を1行で。終了日が無い（ずっと適用）なら日付を作らない。
  return until
    ? `${rate}適用中（${until}まで 月額 ¥${yen(discounted)}）`
    : `${rate}適用中（月額 ¥${yen(discounted)}）`;
}

function untilLabel(value: string | Date | null): string | null {
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(at);
}

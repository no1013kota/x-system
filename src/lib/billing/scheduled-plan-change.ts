import { PLANS, type PlanId } from "@/lib/plans";

/**
 * 予約済みの下位プラン変更の表示文（T-M8-260）。設定の課金タブとApp Shellバナーで同じ文を使う。
 *
 * 予約先と切替日は Stripe の subscription schedule から webhook で `profiles` へ同期した値。
 * 片方だけ入ることは CHECK 制約で無いが、読み手の型は別々に来るので両方揃ったときだけ文を返す。
 */
export interface ScheduledPlanChangeProfile {
  scheduled_plan: PlanId | null;
  scheduled_plan_at: string | Date | null;
}

export function scheduledPlanChangeLabel(profile: ScheduledPlanChangeProfile): string | null {
  if (!profile.scheduled_plan || !profile.scheduled_plan_at) return null;
  const plan = PLANS[profile.scheduled_plan];
  if (!plan) return null;
  const date = new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(
    new Date(profile.scheduled_plan_at),
  );
  return `${date}に${plan.displayName}へ切り替わる予約があります`;
}

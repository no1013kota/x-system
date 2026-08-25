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
  const parts = scheduledPlanChangeParts(profile);
  return parts ? `${parts.date}に${parts.planName}へ切り替わる予約があります` : null;
}

/**
 * プラン名の横に出す短い注記（運営者の指示 2026-08-23）。
 * 下位プランへ変更したあと、**いま何のプランで・いつ何に変わるのか**が同じ場所で読める
 * （契約状態の別行だけだと、プラン名を見た人は今のプランが続くと思ってしまう）。
 */
export function scheduledPlanChangeNote(profile: ScheduledPlanChangeProfile): string | null {
  const parts = scheduledPlanChangeParts(profile);
  return parts ? `${parts.date}に${parts.planName}へ切り替わります` : null;
}

function scheduledPlanChangeParts(
  profile: ScheduledPlanChangeProfile,
): { date: string; planName: string } | null {
  if (!profile.scheduled_plan || !profile.scheduled_plan_at) return null;
  const plan = PLANS[profile.scheduled_plan];
  if (!plan) return null;
  const at = new Date(profile.scheduled_plan_at);
  if (Number.isNaN(at.getTime())) return null;
  return {
    date: new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(at),
    planName: plan.displayName,
  };
}

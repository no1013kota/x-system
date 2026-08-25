import { PLANS, type PlanId } from "@/lib/plans";

/**
 * **解約したあとに残っている無料トライアル**（T-M8-298・運営者の指示 2026-08-25）。
 *
 * トライアル中の解約はその場で終了させる（T-M8-278）が、`profiles.trial_ends_at` は残す。
 * 期限内に戻ってきた人は、**元のプランに限らずどのプランでも、残りの期間を無料で**始められる。
 * 「新しく7日を配り直す」のではなく「残りをそのまま使う」——配り直すと解約と再開を
 * 繰り返すだけで無料期間を延ばせてしまう。
 *
 * 判定をここへ集める。`/plans`・設定＞課金・Checkout・再開APIが**同じ答え**を出さないと、
 * 「画面には無料と書いてあるのに請求された」が起きる。
 */
export function remainingTrialEndSec(
  trialEndsAt: string | Date | null | undefined,
  nowMs: number,
): number | null {
  if (!trialEndsAt) return null;
  const at = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  const ms = at.getTime();
  if (Number.isNaN(ms) || ms <= nowMs) return null;
  return Math.floor(ms / 1000);
}

/** 「2026年8月31日」。残っていなければ null（呼び出し側は行ごと出さない）。 */
export function remainingTrialLabel(
  trialEndsAt: string | Date | null | undefined,
  nowMs: number,
): string | null {
  const sec = remainingTrialEndSec(trialEndsAt, nowMs);
  if (sec === null) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(sec * 1000));
}

/**
 * プラン選択画面の見出し。**どのプランでも無料**であることを、プラン名を伏せずに言う
 * （「再開」だけだと元のプランに戻る話に読めるため）。
 */
export function remainingTrialHeadline(label: string): string {
  return `無料トライアルは${label}まで残っています。どのプランでも、その日までは料金が発生しません。`;
}

/** 選んだプランの説明。トライアル終了後にいくらになるかを同時に言う（黙って請求を始めない）。 */
export function remainingTrialPlanNote(plan: PlanId, label: string): string {
  const yen = new Intl.NumberFormat("ja-JP").format(PLANS[plan].monthlyPriceJpy);
  return `${label}までは無料でお使いいただけます。その後は月額 ¥${yen} のご請求が始まります。`;
}

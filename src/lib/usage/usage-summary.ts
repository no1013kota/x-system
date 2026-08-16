import type { PremiumUsageLimits } from "../plans";

/**
 * premium 月間利用枠の残量サマリ（要件03 §8・要件06 §10, T-M6-12）。usage_counters の当月値と
 * PLANS.premium.usageLimits から used/limit/remaining を算出する純粋関数。SC-05ホーム・SC-11設定の
 * 残量表示と、上限到達エラー表示（残量＋翌月開始日時）に用いる。利用枠を増減する処理は別（reserve/consume）。
 */

export interface UsageSlot {
  used: number;
  limit: number;
  remaining: number;
}

/** 要件03 §8 のJSON形状（3枠・T-M8-109）。表示順は AIクレジット→通常投稿→URL付き投稿。 */
export interface UsageSummary {
  ai_credits: UsageSlot;
  normal_posts: UsageSlot;
  url_posts: UsageSlot;
}

export interface UsageCounters {
  normal_posts_count: number;
  url_posts_count: number;
  ai_credits_used: number;
}

function slot(used: number, limit: number): UsageSlot {
  const u = Math.max(0, Math.trunc(used));
  return { used: u, limit, remaining: Math.max(0, limit - u) };
}

/** usage_counters の当月値と premium 上限から残量サマリを算出する。 */
export function computeUsageSummary(
  counters: UsageCounters,
  limits: PremiumUsageLimits,
): UsageSummary {
  return {
    ai_credits: slot(counters.ai_credits_used, limits.aiCredits),
    normal_posts: slot(counters.normal_posts_count, limits.normalPosts),
    url_posts: slot(counters.url_posts_count, limits.urlPosts),
  };
}

/**
 * 当月枠がリセットされる翌月開始（JST 1日 00:00）の瞬間を UTC Date で返す。上限到達エラー表示の
 * 「翌月開始日時」に使う。`now` は UTC 基準の Date（JST 変換は内部で行う）。12月→翌1月も繰り上がる。
 */
export function nextMonthStartJst(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth(); // 0-based（JST基準）
  // 翌月1日 00:00 JST を UTC で表す（JST = UTC+9 なので 9時間引く）。
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0) - 9 * 60 * 60 * 1000);
}

/** 翌月開始日時を JST の「YYYY年M月D日」表記へ整形する。 */
export function formatNextMonthStartJst(now: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeZone: "Asia/Tokyo",
  }).format(nextMonthStartJst(now));
}

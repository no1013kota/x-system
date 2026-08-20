import { TEXT_DEFAULT_ESTIMATE_CREDITS } from "../ai/model-catalog";
import type { PlanUsageLimits } from "../plans";

/**
 * 運営キー系プラン（premium / expert）の月間利用枠の残量サマリ（要件03 §8・要件06 §10, T-M6-12）。usage_counters の当月値と
 * プランの usageLimits から used/limit/remaining を算出する純粋関数。SC-05ホーム・SC-11設定の
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
  /**
   * 数値を画面に出さないプランか（エキスパート・T-M8-168）。true なら表示は「無制限」、
   * 停止中は「連続的な使用が検知されたため一時的に停止しております。お待ちください。」を出す。
   * **残量・上限の数値をどの画面にも出さない**（内部ガード値を悟らせない）。concealed の
   * summary は3枠とも 0 で返す——設定画面は summary を client component（Flight payload）へ
   * 渡すため、UIで隠すだけでは view-source に内部ガード値が載る。
   */
  concealed: boolean;
  /**
   * 実行が止まる状態か。バナー・カードの停止表示はこのフラグだけを見る（枠のremainingを
   * 再計算しない）。concealed では「どれかの枠が尽きた」に加えて **AIクレジット残が1回分の
   * 見積もり（TEXT_DEFAULT_ESTIMATE_CREDITS）を下回った」時点で true にする——予約起票
   * （operatorBudgetOk）と reserve は「残高が見積もりに満たない」段階で止まるため、
   * remaining=0 まで表示を待つと「止まっているのに画面は何も言わない」期間ができる
   * （エキスパートは数値も閾値通知も無いので、この表示が唯一の気付く経路・原則1）。
   */
  paused: boolean;
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
  limits: PlanUsageLimits,
  options: { concealed?: boolean } = {},
): UsageSummary {
  const concealed = options.concealed === true;
  const aiCredits = slot(counters.ai_credits_used, limits.aiCredits);
  const normalPosts = slot(counters.normal_posts_count, limits.normalPosts);
  const urlPosts = slot(counters.url_posts_count, limits.urlPosts);
  const exhausted = [aiCredits, normalPosts, urlPosts].some((s) => s.remaining <= 0);
  const paused = concealed
    ? exhausted || aiCredits.remaining < TEXT_DEFAULT_ESTIMATE_CREDITS
    : exhausted;
  const empty: UsageSlot = { used: 0, limit: 0, remaining: 0 };
  return {
    ai_credits: concealed ? empty : aiCredits,
    normal_posts: concealed ? empty : normalPosts,
    url_posts: concealed ? empty : urlPosts,
    concealed,
    paused,
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

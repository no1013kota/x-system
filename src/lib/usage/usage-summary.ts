import { TEXT_DEFAULT_ESTIMATE_CREDITS } from "../ai/model-catalog";
import { concealsUsageLimits, usageLimitsForPlan, type PlanUsageLimits } from "../plans";

/**
 * 運営キー系プラン（premium / expert）の利用枠（契約期間ごと・T-M8-258）の残量サマリ（要件03 §8・要件06 §10, T-M6-12）。
 * usage_counters の今期の値とプランの usageLimits から used/limit/remaining を算出する純粋関数。SC-05ホーム・SC-11設定の
 * 残量表示と、上限到達エラー表示（残量＋次回更新日）に用いる。利用枠を増減する処理は別（reserve/consume）。
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
  /**
   * 枠がリセットされる日時（ISO）＝契約の次回更新日（`profiles.current_period_end`・T-M8-258）。
   * 未同期なら null（画面は日付を作らず「次回の更新日」と書く）。
   */
  resetsAt: string | null;
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
  options: { concealed?: boolean; resetsAt?: string | null } = {},
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
    resetsAt: options.resetsAt ?? null,
  };
}

/**
 * 枠がリセットされる日（次回更新日）の JST「YYYY年M月D日」表記（T-M8-258）。
 * 日付が無い・壊れているときは存在しない日付を作らず「次回の更新日」と書く。
 */
export function usageResetLabel(summary: Pick<UsageSummary, "resetsAt">): string {
  if (!summary.resetsAt) return "次回の更新日";
  const at = new Date(summary.resetsAt);
  if (Number.isNaN(at.getTime())) return "次回の更新日";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "long", timeZone: "Asia/Tokyo" }).format(at);
}

/**
 * カウンタ行（無ければ0）とプランから利用枠サマリを作る単一正本（T-M8-288）。
 *
 * 以前は `loadUsageSummary`（SQL付き）の中にだけこの組み立てがあり、同じ値を別経路
 * （App Shellの1文へ束ねた読み取り）から作りたいときに写経が必要だった。**読み方（SQL）と
 * 組み立て方（判定）を分ける**ことで、どちらから来ても同じ結果になる。
 */
export function usageSummaryFrom(
  counters: UsageCounters | null,
  plan: string,
  resetsAt: string | null,
): UsageSummary | null {
  const limits = usageLimitsForPlan(plan);
  if (!limits) return null;
  return computeUsageSummary(
    counters ?? { ai_credits_used: 0, normal_posts_count: 0, url_posts_count: 0 },
    limits,
    { concealed: concealsUsageLimits(plan), resetsAt },
  );
}

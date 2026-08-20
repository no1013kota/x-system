import "server-only";
import { CURRENT_MONTH_JST_SQL } from "./current-month";

import { getPool } from "../db/pool";
import { concealsUsageLimits, usageLimitsForPlan } from "../plans";
import { computeUsageSummary, type UsageCounters, type UsageSummary } from "./usage-summary";

/**
 * 運営キー系プラン（premium / expert）の当月（JST）利用枠サマリを usage_counters から読む
 * （要件03 §8, T-M6-12/T-M8-168）。BYOK（standard）は枠を持たないため null を返す
 * （SC-05/SC-11 は非表示にする）。counter 行が無ければ全0。expert は `concealed: true` が付き、
 * 画面は数値を出さず「無制限」と表示する。
 */
export async function loadUsageSummaryForUser(
  userId: string,
  plan: string,
): Promise<UsageSummary | null> {
  const limits = usageLimitsForPlan(plan);
  if (!limits) return null;
  const { rows } = await getPool().query<UsageCounters>(
    `select coalesce(normal_posts_count, 0) as normal_posts_count,
            coalesce(url_posts_count, 0) as url_posts_count,
            coalesce(ai_credits_used, 0) as ai_credits_used
       from usage_counters
      where user_id = $1
        and month = ${CURRENT_MONTH_JST_SQL}`,
    [userId],
  );
  const counters = rows[0] ?? {
    normal_posts_count: 0,
    url_posts_count: 0,
    ai_credits_used: 0,
  };
  return computeUsageSummary(counters, limits, { concealed: concealsUsageLimits(plan) });
}

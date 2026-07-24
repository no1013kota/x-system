import "server-only";

import { getPool } from "../db/pool";
import { PLANS } from "../plans";
import { computeUsageSummary, type UsageCounters, type UsageSummary } from "./usage-summary";

/**
 * premium ユーザーの当月（JST）利用枠サマリを usage_counters から読む（要件03 §8, T-M6-12）。
 * premium 以外は枠を持たないため null を返す（SC-05/SC-11 は非表示にする）。counter 行が無ければ全0。
 */
export async function loadUsageSummaryForUser(
  userId: string,
  plan: string,
): Promise<UsageSummary | null> {
  const limits = PLANS.premium.usageLimits;
  if (plan !== "premium" || !limits) return null;
  const { rows } = await getPool().query<UsageCounters>(
    `select coalesce(normal_posts_count, 0) as normal_posts_count,
            coalesce(url_posts_count, 0) as url_posts_count,
            coalesce(generations_count, 0) as generations_count,
            coalesce(images_count, 0) as images_count
       from usage_counters
      where user_id = $1
        and month = to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM')`,
    [userId],
  );
  const counters = rows[0] ?? {
    normal_posts_count: 0,
    url_posts_count: 0,
    generations_count: 0,
    images_count: 0,
  };
  return computeUsageSummary(counters, limits);
}

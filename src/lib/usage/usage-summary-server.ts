import "server-only";

import { getPool } from "../db/pool";
import type { Queryable } from "../db/queryable";
import { usagePeriodKeySql, usageResetsAtExpr } from "./usage-period";
import { usageSummaryFrom, type UsageCounters, type UsageSummary } from "./usage-summary";

/**
 * 運営キー系プラン（premium / expert）の**今の契約期間**の利用枠サマリを usage_counters から読む
 * （期間キーは `usage-period.ts`・T-M8-258。リセット日は `current_period_end`）
 * （要件03 §8, T-M6-12/T-M8-168）。BYOK（standard）は枠を持たないため null を返す
 * （SC-05/SC-11 は非表示にする）。counter 行が無ければ全0。expert は `concealed: true` が付き、
 * 画面は数値を出さず「無制限」と表示する。
 */
export async function loadUsageSummaryForUser(
  userId: string,
  plan: string,
): Promise<UsageSummary | null> {
  return loadUsageSummary(getPool(), userId, plan);
}

/** db注入版（App Shellの単一接続ロード用・T-M8-197）。判定は同じ。 */
export async function loadUsageSummary(
  db: Queryable,
  userId: string,
  plan: string,
): Promise<UsageSummary | null> {
  const { rows } = await db.query<UsageCounters & { resets_at: string | null }>(
    `select coalesce(c.normal_posts_count, 0) as normal_posts_count,
            coalesce(c.url_posts_count, 0) as url_posts_count,
            coalesce(c.ai_credits_used, 0) as ai_credits_used,
            -- リセット日は期間が同期済みのときだけ（未同期は暦月で数えている）。トライアル中も出さない
            -- （リセットは最初の有料期間の終わり・usage-period.ts）。
            ${usageResetsAtExpr("p")}::text as resets_at
       from profiles p
       left join usage_counters c
         on c.user_id = p.id and c.month = ${usagePeriodKeySql("$1")}
      where p.id = $1`,
    [userId],
  );
  const row = rows[0];
  // 組み立ては純粋層の単一正本へ（T-M8-288。App Shellの束ね読みと同じ結果になる）。
  return usageSummaryFrom(row ?? null, plan, row?.resets_at ?? null);
}

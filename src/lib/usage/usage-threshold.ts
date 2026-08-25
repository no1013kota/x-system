import { concealsUsageLimits, usageLimitsForPlan } from "../plans";
import type { Queryable } from "../x/token-refresh";

/**
 * 運営キー系プランの利用枠 80%/100% 到達通知（要件03 §8, T-M6-13 / T-M8-168）。
 * counter 更新直後に新カウントを渡して呼ぶ。プランと上限は同一transaction内で profiles から読む
 * （呼び出し3箇所が plan を持っていないため。PKの1行読みで済む）。
 *
 * **利用枠を画面に出さないプラン（エキスパート）には作らない**——「上限の80%」という通知自体が
 * 内部ガード値を漏らす。到達時の見せ方は常設バナーとusage_paused（一時停止の文言）が担う。
 * 枠・期間・閾値ごとに dedupe_key `usage:{period}:{key}:{80|100}` で1件だけ作る（T-M8-258: 期間＝契約期間）（再更新・再実行は on conflict
 * で no-op）。notification_config の `usage` 設定を尊重し、両channel OFFなら通知を作らない（100%常設バナーは
 * 別途 App Shell が残量から表示するため、通知設定に関わらず表示される）。counter 更新と同一transactionで呼ぶ。
 */

export type UsageCounterKey = "normal_posts" | "url_posts" | "ai_credits";

function limitFor(plan: string | null, key: UsageCounterKey): number | undefined {
  const limits = usageLimitsForPlan(plan);
  if (!limits) return undefined;
  return { normal_posts: limits.normalPosts, url_posts: limits.urlPosts, ai_credits: limits.aiCredits }[key];
}

const LABEL: Record<UsageCounterKey, string> = {
  normal_posts: "通常投稿クレジット",
  url_posts: "URL付き投稿クレジット",
  ai_credits: "AIクレジット",
};

async function insertUsageNotification(
  db: Queryable,
  params: { userId: string; key: UsageCounterKey; threshold: 80 | 100; limit: number; periodKey: string },
): Promise<void> {
  const label = LABEL[params.key];
  const title =
    params.threshold === 100 ? `${label}が上限に達しました` : `${label}が上限の80%に達しました`;
  const body =
    params.threshold === 100
      ? `${label}の今の契約期間の上限（${params.limit}）に達しました。次回の更新日にリセットされます。既存の下書きの閲覧・編集は引き続きできます。`
      : `${label}が今の契約期間の上限（${params.limit}）の80%に達しました。残量にご注意ください。`;
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled)
     select $1, 'usage',
            'usage:' || $6 || ':' || $2 || ':' || $3::text,
            $4, $5, '/app/settings?tab=billing',
            jsonb_build_object('counter_type', $2::text, 'threshold', $3::int),
            coalesce((p.notification_config->'usage'->>'in_app')::boolean, false)
       from profiles p
      where p.id = $1
        and coalesce((p.notification_config->'usage'->>'in_app')::boolean, false)
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, params.key, params.threshold, title, body, params.periodKey],
  );
}

/**
 * 新カウントが閾値（80%＝ceil(limit×0.8)、100%＝limit）以上の枠について usage 通知を冪等に作る。
 * dedupe_key が枠・期間・閾値ごとに一意なので「1件だけ」「跨いだ後の再更新で重複しない」が保証される。
 * `periodKey` は counter を更新した行の期間キー（精算・返却は元reserveの期間）。
 */
export async function notifyUsageThresholds(
  db: Queryable,
  params: { userId: string; key: UsageCounterKey; newCount: number; periodKey: string },
): Promise<void> {
  const { rows } = await db.query<{ plan: string | null }>(
    `select plan from profiles where id = $1`,
    [params.userId],
  );
  const plan = rows[0]?.plan ?? null;
  if (concealsUsageLimits(plan)) return; // エキスパート: 数値を通知で漏らさない（T-M8-168）
  const limit = limitFor(plan, params.key);
  if (!limit) return;
  const thresholds: { pct: 80 | 100; at: number }[] = [
    { pct: 80, at: Math.ceil(limit * 0.8) },
    { pct: 100, at: limit },
  ];
  for (const t of thresholds) {
    if (params.newCount < t.at) continue;
    await insertUsageNotification(db, {
      userId: params.userId,
      key: params.key,
      threshold: t.pct,
      limit,
      periodKey: params.periodKey,
    });
  }
}

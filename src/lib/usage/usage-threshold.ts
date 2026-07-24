import { PLANS } from "../plans";
import type { Queryable } from "../x/token-refresh";

/**
 * premium 利用枠の 80%/100% 到達通知（要件03 §8, T-M6-13）。counter 更新直後に新カウントを渡して呼ぶ。
 * 枠・月・閾値ごとに dedupe_key `usage:{month}:{key}:{80|100}` で1件だけ作る（再更新・再実行は on conflict
 * で no-op）。notification_config の `usage` 設定を尊重し、両channel OFFなら通知を作らない（100%常設バナーは
 * 別途 App Shell が残量から表示するため、通知設定に関わらず表示される）。counter 更新と同一transactionで呼ぶ。
 */

export type UsageCounterKey = "normal_posts" | "url_posts" | "generations" | "images";

const LIMIT_BY_KEY: Record<UsageCounterKey, number | undefined> = {
  normal_posts: PLANS.premium.usageLimits?.normalPosts,
  url_posts: PLANS.premium.usageLimits?.urlPosts,
  generations: PLANS.premium.usageLimits?.generations,
  images: PLANS.premium.usageLimits?.images,
};

const LABEL: Record<UsageCounterKey, string> = {
  normal_posts: "通常投稿枠",
  url_posts: "URL付き投稿枠",
  generations: "生成枠",
  images: "画像枠",
};

const MONTH_EXPR = `to_char((now() at time zone 'Asia/Tokyo'), 'YYYY-MM')`;

async function insertUsageNotification(
  db: Queryable,
  params: { userId: string; key: UsageCounterKey; threshold: 80 | 100; limit: number },
): Promise<void> {
  const label = LABEL[params.key];
  const title =
    params.threshold === 100 ? `${label}が今月の上限に達しました` : `${label}が今月の上限の80%に達しました`;
  const body =
    params.threshold === 100
      ? `${label}の今月の上限（${params.limit}）に達しました。翌月にリセットされます。既存の下書きの閲覧・編集は引き続きできます。`
      : `${label}が今月の上限（${params.limit}）の80%に達しました。残量にご注意ください。`;
  await db.query(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload,
        in_app_enabled, email_status, email_available_at)
     select $1, 'usage',
            'usage:' || ${MONTH_EXPR} || ':' || $2 || ':' || $3::text,
            $4, $5, '/app/settings?tab=billing',
            jsonb_build_object('counter_type', $2::text, 'threshold', $3::int),
            coalesce((p.notification_config->'usage'->>'in_app')::boolean, false),
            case when coalesce((p.notification_config->'usage'->>'email')::boolean, false)
                 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
            case when coalesce((p.notification_config->'usage'->>'email')::boolean, false)
                 then now() else null end
       from profiles p
      where p.id = $1
        and (coalesce((p.notification_config->'usage'->>'in_app')::boolean, false)
             or coalesce((p.notification_config->'usage'->>'email')::boolean, false))
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing`,
    [params.userId, params.key, params.threshold, title, body],
  );
}

/**
 * 新カウントが閾値（80%＝ceil(limit×0.8)、100%＝limit）以上の枠について usage 通知を冪等に作る。
 * dedupe_key が枠・月・閾値ごとに一意なので「1件だけ」「跨いだ後の再更新で重複しない」が保証される。
 */
export async function notifyUsageThresholds(
  db: Queryable,
  params: { userId: string; key: UsageCounterKey; newCount: number },
): Promise<void> {
  const limit = LIMIT_BY_KEY[params.key];
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
    });
  }
}

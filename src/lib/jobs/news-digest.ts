import type { Queryable } from "../x/token-refresh";

/**
 * 時間単位ニュースダイジェスト通知の fan-out（要件04 §14, 要件02 §4.2/§4.3, N-3/O-2, T-M4-12）。
 * news_fetch の6分野settle後に、当該1時間窓（UTC hour-aligned）で新規保存された news_items を対象に、
 * `subscription_status in (trialing, active)` かつニュース通知のいずれかのchannelがONのユーザーへ、
 * 各自の `news_config`（categories ∩ impact_filter）で一致する新着を集約して通知rowを1件作る。
 *
 * - 該当0件・両channel OFF・非契約ユーザーには作らない（一致集合が空なら行が出ない）。
 * - `user_id + dedupe_key`（`news-digest:{window_started_at}`）で同一窓の再実行を冪等化する。
 * - タイトル/本文は高impact優先・同impactは新しい順で最大5件＋全件数＋一覧リンク。payloadの
 *   `news_item_ids` は `max_items`（既定20）まで、`total_count` は全件数を保持する。
 * - 一部分野の失敗は「新規行が無い」だけで自然に除外され、失敗自体はニュース通知しない（要件04 §6）。
 */

export interface NewsDigestDeps {
  db: Queryable;
  /** 対象1時間窓の開始（UTC hour-aligned）。news_fetch起動時刻を hour floor した値。 */
  windowStart: Date;
}

export interface NewsDigestResult {
  /** 一致新着があり通知対象になったユーザー数。 */
  matchedUsers: number;
  /** 実際に作成した通知row数（再実行時の重複はdedupeで0）。 */
  notified: number;
  /** 新規作成した通知のid（commit後の after() メール送信に渡す）。 */
  createdIds: string[];
}

/** hour-aligned ISO（millisを除去し `...:00:00Z` 形へ。dedupe/payload/link で一貫使用）。 */
function hourIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface DigestRow {
  user_id: string;
  in_app: boolean;
  email: boolean;
  total_count: number;
  item_ids: string[];
  top_titles: string[];
}

/** 窓内新着 × 各ユーザーの news_config を突き合わせ、通知対象ユーザーの集約を返す。 */
async function loadDigestRows(
  db: Queryable,
  windowStart: Date,
  windowEnd: Date,
): Promise<DigestRow[]> {
  const { rows } = await db.query<DigestRow>(
    `with new_items as (
       select id, category::text as category, impact::text as impact, title, fetched_at
         from news_items
        where fetched_at >= $1 and fetched_at < $2
     ),
     eligible as (
       select p.id as user_id,
              coalesce(p.news_config->'categories', '[]'::jsonb) as categories,
              coalesce(p.news_config->'impact_filter', '[]'::jsonb) as impact_filter,
              coalesce((p.news_config->>'max_items')::int, 20) as max_items,
              coalesce((p.notification_config->'news'->>'in_app')::boolean, false) as in_app,
              coalesce((p.notification_config->'news'->>'email')::boolean, false) as email
         from profiles p
        where p.subscription_status in ('trialing', 'active')
          and (coalesce((p.notification_config->'news'->>'in_app')::boolean, false)
               or coalesce((p.notification_config->'news'->>'email')::boolean, false))
     ),
     matched as (
       select e.user_id, e.max_items, e.in_app, e.email, ni.id, ni.title, ni.impact,
              row_number() over (
                partition by e.user_id
                order by case ni.impact when 'high' then 0 when 'mid' then 1 else 2 end,
                         ni.fetched_at desc
              ) as rn
         from eligible e
         join new_items ni
           on (e.categories ? ni.category) and (e.impact_filter ? ni.impact)
     )
     select user_id, in_app, email,
            count(*)::int as total_count,
            coalesce(
              jsonb_agg(id order by rn) filter (where rn <= max_items),
              '[]'::jsonb
            ) as item_ids,
            coalesce(
              array_agg(title order by rn) filter (where rn <= 5),
              '{}'
            ) as top_titles
       from matched
      group by user_id, in_app, email`,
    [windowStart.toISOString(), windowEnd.toISOString()],
  );
  return rows;
}

/** ダイジェストの本文（先頭5件＋超過分の件数）。 */
function buildBody(topTitles: string[], totalCount: number): string {
  const lines = topTitles.map((t) => `・${t}`);
  const remaining = totalCount - topTitles.length;
  if (remaining > 0) lines.push(`ほか${remaining}件`);
  return lines.join("\n");
}

export async function fanOutNewsDigest(deps: NewsDigestDeps): Promise<NewsDigestResult> {
  const windowStart = deps.windowStart;
  const windowEnd = new Date(windowStart.getTime() + 3600 * 1000);
  const fromIso = hourIso(windowStart);
  const toIso = hourIso(windowEnd);
  const dedupeKey = `news-digest:${fromIso}`;
  const link = `/app/news?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

  const digestRows = await loadDigestRows(deps.db, windowStart, windowEnd);

  const createdIds: string[] = [];
  for (const row of digestRows) {
    const title = `ニュースダイジェスト ${row.total_count}件`;
    const body = buildBody(row.top_titles, row.total_count);
    const payload = {
      window_started_at: fromIso,
      window_ended_at: toIso,
      total_count: row.total_count,
      news_item_ids: row.item_ids,
    };
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into notifications
         (user_id, type, dedupe_key, title, body, link, payload,
          in_app_enabled, email_status, email_available_at)
       values ($1, 'news', $2, $3, $4, $5, $6::jsonb, $7,
               case when $8 then 'queued'::email_delivery_status else 'not_requested'::email_delivery_status end,
               case when $8 then now() else null end)
       on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
       returning id`,
      [row.user_id, dedupeKey, title, body, link, JSON.stringify(payload), row.in_app, row.email],
    );
    if (rows[0]) createdIds.push(rows[0].id);
  }

  return { matchedUsers: digestRows.length, notified: createdIds.length, createdIds };
}

/** UTC hour-aligned な窓開始（news_fetch起動時刻から算出）。 */
export function newsDigestWindowStart(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

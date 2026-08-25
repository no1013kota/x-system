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
 *   `news_item_ids` は固定20件まで（旧`news_config.max_items`はT-M8-187で廃止）、`total_count` は全件数を保持する。
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

/**
 * 窓ごとのdedupe key。**テストの後片付けでも使う**ため公開する（T-M8-64・bug）。
 *
 * fan-outは条件が合う**全利用者**へ配る。DBテストが後片付けでテスト用ユーザーの通知しか
 * 消していなかったため、共有ローカルDBでは**開発者の実アカウントにも未来窓の偽ダイジェスト
 * が届き、残り続けた**（通知を押すと未来の時間窓のニュース＝常に0件）。窓のkeyで消せば
 * 誰に配られたかを知らなくても全部消せる。
 */
export function newsDigestDedupeKey(windowStart: Date): string {
  return `news-digest:${hourIso(windowStart)}`;
}

interface DigestRow {
  user_id: string;
  in_app: boolean;
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
              20 as max_items, -- 旧news_config.max_itemsはT-M8-187で廃止（payload上限は固定20）
              coalesce((p.notification_config->'news'->>'in_app')::boolean, false) as in_app
         from profiles p
        where p.subscription_status in ('trialing', 'active')
          -- 通知はアプリ内のみ（メールはT-M8-222で廃止）。in_app OFF の利用者には行を作らない。
          and coalesce((p.notification_config->'news'->>'in_app')::boolean, false)
     ),
     matched as (
       select e.user_id, e.max_items, e.in_app, ni.id, ni.title, ni.impact,
              row_number() over (
                partition by e.user_id
                order by case ni.impact when 'high' then 0 when 'mid' then 1 else 2 end,
                         ni.fetched_at desc
              ) as rn
         from eligible e
         join new_items ni
           on (e.categories ? ni.category) and (e.impact_filter ? ni.impact)
     )
     select user_id, in_app,
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
      group by user_id, in_app`,
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
  const dedupeKey = newsDigestDedupeKey(windowStart);
  const link = `/app/news?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;

  const digestRows = await loadDigestRows(deps.db, windowStart, windowEnd);

  /*
    **1文でまとめて作る**（T-M8-290）。以前は対象者1人につき1往復を直列に投げており、
    利用者が増えるほどcronの所要時間が線形に伸びた（1日5回走るニュース取得の最後で、
    ここが遅れると同じ窓のダイジェストがまるごと落ちる）。

    **`values` ではなく `profiles` を join して `for key share` する**形は維持する（T-M7-54, T-M8-19）。
    対象を選んでから挿入するまでの間にその利用者が退会すると、`values` では外部キー違反で例外になり、
    **まだ配信していない他の利用者の分まで巻き添えで止まる**。消えていればその行が0件になるだけ、
    という形にして1人の退会が全体を壊さないようにする。

    `for key share of p` が要る理由（T-M8-19）: **同じ文の中でも、SELECT が見る行と外部キー検査が
    見る行は別のスナップショット**で決まる。SELECT の直後に退会がコミットされると、検査時点では
    親行が無く外部キー違反になった（2026-08-03、`npm test` の並列実行で3回に1回ほど再現）。
    親行を先にロックしておけば、退会はこの文の完了まで待たされ、先に消えていれば0行になる。
  */
  if (digestRows.length === 0) {
    return { matchedUsers: 0, notified: 0, createdIds: [] };
  }
  const { rows: created } = await deps.db.query<{ id: string }>(
    `insert into notifications
       (user_id, type, dedupe_key, title, body, link, payload, in_app_enabled)
     select p.id, 'news', $2, u.title, u.body, $3, u.payload::jsonb, u.in_app
       from unnest($1::uuid[], $4::text[], $5::text[], $6::text[], $7::boolean[])
              as u(user_id, title, body, payload, in_app)
       join profiles p on p.id = u.user_id
        for key share of p
     on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
     returning id`,
    [
      digestRows.map((row) => row.user_id),
      dedupeKey,
      link,
      digestRows.map((row) => `ニュースダイジェスト ${row.total_count}件`),
      digestRows.map((row) => buildBody(row.top_titles, row.total_count)),
      digestRows.map((row) =>
        JSON.stringify({
          window_started_at: fromIso,
          window_ended_at: toIso,
          total_count: row.total_count,
          news_item_ids: row.item_ids,
        }),
      ),
      digestRows.map((row) => row.in_app),
    ],
  );
  const createdIds = created.map((row) => row.id);

  return { matchedUsers: digestRows.length, notified: createdIds.length, createdIds };
}

/** UTC hour-aligned な窓開始（news_fetch起動時刻から算出）。 */
export function newsDigestWindowStart(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

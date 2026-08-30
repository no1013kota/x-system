import { NEWS_FETCH_CATEGORIES, type NewsCategory } from "../news";
import { NEWS_FEEDS } from "../news/feeds";
import {
  applyRecencyPolicy,
  clampSummary,
  clampTitle,
  type NewsItemOut,
  newsItemSchema,
} from "../news/item-rules";
import { parseFeed } from "../news/rss";
import type { ArticleForSummary, SummarizedArticle } from "../news/summarize-server";
import { canonicalizeSourceUrl } from "../news-url";
import type { Queryable } from "../x/token-refresh";

/**
 * RSS巡回によるニュース取得（T-M8-380・運営者の指示 2026-08-30「既存のAIリサーチは不要。
 * UIは維持したまま裏側を新しい仕組みへ」）。
 *
 * ## 旧仕組みからの置き換え
 * 旧: 1日2回、AIがWeb検索でリサーチ（1回$2.3・月$137〜156）。
 * 新: **20分おきにRSSを巡回**（発見は無料）し、新着があったときだけ安いモデルで
 * 日本語要約とimpact判定を行う（月$1〜3）。保存先（news_items）・結果の記録
 * （news_fetch_outcomes）・ダイジェスト通知は旧仕組みと同じものを使う——
 * 画面・投稿生成（P1/P6の材料）・doctorは何も変わらない。
 *
 * ## 設計
 * - フィード1本の不調で分野を失敗させない（分野の**全**フィードが失敗したときだけ ok=false）
 * - 要約AIが失敗しても**フィードの生情報で保存する**（errorCode='summary_fallback'。
 *   ニュースが止まるより、素のタイトルで載る方が害が小さい・原則1）
 * - 新着は1分野1回あたり `MAX_NEW_PER_RUN` 件まで（初回やフィード追加直後の洪水で
 *   要約コストが跳ねないように。残りは次の巡回が拾う——48時間の鮮度窓の中にいる限り再訪する）
 */

/** 鮮度窓（時間）。これ＋許容24時間より古い記事は保存しない（item-rules の recency 判定を流用）。 */
export const RSS_FRESHNESS_HOURS = 48;

/** 1分野1回の巡回で新規保存する上限。 */
export const MAX_NEW_PER_RUN = 15;

export interface FetchedFeed {
  ok: boolean;
  status: number;
  text: string;
}

export interface NewsRssDeps {
  db: Queryable;
  /** フィード取得（route が timeout・UA 付きの実fetchを渡す。テストは偽物を注入）。 */
  fetchFeed: (url: string) => Promise<FetchedFeed>;
  /** 新着の要約。null=失敗（フォールバック保存へ）。テストでは偽物を注入。 */
  summarize: (
    category: NewsCategory,
    articles: ArticleForSummary[],
  ) => Promise<SummarizedArticle[] | null>;
  now?: Date;
  /** 分野ごとの結果を残す窓key（news_fetch_outcomes）。省略時は記録しない。 */
  windowKey?: string;
  categories?: readonly NewsCategory[];
  onError?: (category: NewsCategory, err: unknown) => void;
}

export interface NewsRssCategoryResult {
  category: NewsCategory;
  ok: boolean;
  /** 新着として要約対象になった件数。 */
  fetched: number;
  /** 実際に保存した件数。 */
  saved: number;
  dropped: number;
  dropReasons: Record<string, number>;
  futureAdjusted: number;
  /** 読めたフィード数 / 全フィード数。 */
  feedsOk: number;
  feedsTotal: number;
  /** 要約AIが失敗してフィードの生情報で保存した場合 'summary_fallback'。 */
  errorCode: string | null;
}

export interface NewsRssResult {
  categories: NewsRssCategoryResult[];
  totalSaved: number;
  emptyCategories: { category: NewsCategory; reason: "no_match" | "all_dropped" | "failed" }[];
}

/** 分野の新規ニュースを保存する（canonical source_url・on conflict do nothing で重複排除）。 */
async function saveItems(
  db: Queryable,
  category: NewsCategory,
  items: NewsItemOut[],
): Promise<number> {
  let saved = 0;
  for (const item of items) {
    const { rowCount } = await db.query(
      `insert into news_items (category, title, summary, source_url, impact, published_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (source_url) do nothing`,
      [category, item.title, item.summary, item.source_url, item.impact, item.published_at ?? null],
    );
    if ((rowCount ?? 0) > 0) saved += 1;
  }
  return saved;
}

/** 分野ごとの結果を `news_fetch_outcomes` へ残す（旧仕組みと同じ表・T-M7-40）。 */
async function recordOutcome(
  db: Queryable,
  windowKey: string,
  r: NewsRssCategoryResult,
): Promise<void> {
  await db.query(
    `insert into news_fetch_outcomes
       (window_key, category, ok, fetched, saved, dropped, future_adjusted, drop_reasons,
        error_code, provider_raw_error)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, null)
     on conflict (window_key, category) do update
        set ok = excluded.ok, fetched = excluded.fetched, saved = excluded.saved,
            dropped = excluded.dropped, future_adjusted = excluded.future_adjusted,
            drop_reasons = excluded.drop_reasons,
            error_code = excluded.error_code,
            provider_raw_error = null, ran_at = now()`,
    [
      windowKey,
      r.category,
      r.ok,
      r.fetched,
      r.saved,
      r.dropped,
      r.futureAdjusted,
      JSON.stringify(r.dropReasons),
      r.errorCode,
    ],
  );
}

/** DBに既にあるURLを除く（要約コストを新着だけに絞る）。 */
async function filterKnown(db: Queryable, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const { rows } = await db.query<{ source_url: string }>(
    `select source_url from news_items where source_url = any($1)`,
    [urls],
  );
  return new Set(rows.map((r) => r.source_url));
}

async function runCategory(
  deps: NewsRssDeps,
  category: NewsCategory,
  now: Date,
  prefetched: Map<string, FetchedFeed>,
): Promise<NewsRssCategoryResult> {
  const feeds = NEWS_FEEDS[category] ?? [];
  const entries: ArticleForSummary[] = [];
  let feedsOk = 0;
  for (const feed of feeds) {
    const res = prefetched.get(feed.url);
    if (!res || !res.ok) continue;
    feedsOk += 1;
    for (const e of parseFeed(res.text)) {
      entries.push({
        url: canonicalizeSourceUrl(e.link),
        source: feed.source,
        title: e.title,
        snippet: e.snippet,
        publishedAt: e.publishedAt,
      });
    }
  }
  const base: Omit<NewsRssCategoryResult, "ok" | "errorCode"> = {
    category,
    fetched: 0,
    saved: 0,
    dropped: 0,
    dropReasons: {},
    futureAdjusted: 0,
    feedsOk,
    feedsTotal: feeds.length,
  };
  if (feeds.length > 0 && feedsOk === 0) {
    // 全フィードが読めない＝ネットワークかフィード側の異常。0件と区別して失敗にする。
    return { ...base, ok: false, errorCode: "feed_fetch_failed" };
  }

  // 重複（同一巡回内・DB既存）を除き、新しい順に上限まで。
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });
  const known = await filterKnown(
    deps.db,
    unique.map((e) => e.url),
  );
  const fresh = unique
    .filter((e) => !known.has(e.url))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, MAX_NEW_PER_RUN);
  if (fresh.length === 0) {
    return { ...base, ok: true, errorCode: null };
  }

  // 要約（失敗したらフィードの生情報でフォールバック）。
  let summarized: SummarizedArticle[] | null = null;
  try {
    summarized = await deps.summarize(category, fresh);
  } catch (err) {
    deps.onError?.(category, err);
    summarized = null;
  }
  const byUrl = new Map((summarized ?? []).map((s) => [s.url, s]));
  const fallback = summarized === null;

  const candidates: unknown[] = fresh.map((a) => {
    const s = byUrl.get(a.url);
    return {
      title: s ? s.title : clampTitle(a.title),
      summary: s ? s.summary : clampSummary(a.snippet || a.title),
      source_url: a.url,
      impact: s ? s.impact : "mid",
      published_at: a.publishedAt ?? undefined,
    };
  });

  // 保存規定（item-rules）は旧仕組みと同じものを通す。
  const reasons: Record<string, number> = {};
  let dropped = 0;
  const valid: NewsItemOut[] = [];
  for (const c of candidates) {
    const parsed = newsItemSchema.safeParse(c);
    if (parsed.success) valid.push(parsed.data);
    else {
      dropped += 1;
      for (const issue of parsed.error.issues) {
        const key = `${issue.path.join(".") || "(root)"}:${issue.code}`;
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    }
  }
  const recency = applyRecencyPolicy(valid, { now, hours: RSS_FRESHNESS_HOURS });
  dropped += recency.dropped;
  for (const [k, v] of Object.entries(recency.reasons)) reasons[k] = (reasons[k] ?? 0) + v;

  const saved = await saveItems(deps.db, category, recency.items);
  return {
    ...base,
    ok: true,
    fetched: fresh.length,
    saved,
    dropped,
    dropReasons: reasons,
    futureAdjusted: recency.futureAdjusted,
    errorCode: fallback ? "summary_fallback" : null,
  };
}

/** 0件だった分野が「該当なし」「全件破棄」「失敗」のどれかを判定する（旧仕組みと同じ意味論）。 */
export function emptyReasonOf(
  r: NewsRssCategoryResult,
): "no_match" | "all_dropped" | "failed" | null {
  if (!r.ok) return "failed";
  if (r.saved > 0) return null;
  if (r.fetched === 0) return "no_match";
  return r.dropped > 0 ? "all_dropped" : "no_match";
}

export async function runNewsRssFetch(deps: NewsRssDeps): Promise<NewsRssResult> {
  const now = deps.now ?? new Date();
  const categories = deps.categories ?? NEWS_FETCH_CATEGORIES;

  /*
    **全フィードを並列で先読みする**（本番初回で実測: 直列だと17本×最大10秒で
    maxDuration 120秒を超えて504になった・2026-08-30）。壁時間は「最も遅い1本」まで縮む。
    失敗したフィードはMapに載らない＝runCategory側で「読めなかった」として数える。
  */
  const prefetched = new Map<string, FetchedFeed>();
  await Promise.all(
    categories.flatMap((category) =>
      (NEWS_FEEDS[category] ?? []).map(async (feed) => {
        try {
          prefetched.set(feed.url, await deps.fetchFeed(feed.url));
        } catch (err) {
          deps.onError?.(category, err);
        }
      }),
    ),
  );

  const results: NewsRssCategoryResult[] = [];
  for (const category of categories) {
    let result: NewsRssCategoryResult;
    try {
      result = await runCategory(deps, category, now, prefetched);
    } catch (err) {
      // 分野単位で失敗しても他分野を止めない（旧仕組みと同じ・要件04 §6）。
      deps.onError?.(category, err);
      result = {
        category,
        ok: false,
        fetched: 0,
        saved: 0,
        dropped: 0,
        dropReasons: {},
        futureAdjusted: 0,
        feedsOk: 0,
        feedsTotal: (NEWS_FEEDS[category] ?? []).length,
        errorCode: "category_failed",
      };
    }
    if (deps.windowKey) {
      try {
        await recordOutcome(deps.db, deps.windowKey, result);
      } catch (err) {
        deps.onError?.(category, err);
      }
    }
    results.push(result);
  }
  return {
    categories: results,
    totalSaved: results.reduce((s, r) => s + r.saved, 0),
    emptyCategories: results.flatMap((r) => {
      const reason = emptyReasonOf(r);
      return reason ? [{ category: r.category, reason }] : [];
    }),
  };
}

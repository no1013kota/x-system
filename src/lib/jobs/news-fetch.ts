import { NEWS_CATEGORIES, type NewsCategory } from "../news";
import { canonicalizeSourceUrl } from "../news-url";
import type { Queryable } from "../x/token-refresh";
import type { NewsItemOut, NewsResearchResult } from "./news-research";

/**
 * news_fetch オーケストレーション（要件04 §2/§6, N-1, T-M4-11）。6分野を最大3並列でリサーチし、
 * 分野ごとに独立してnews_itemsへcommitする。1分野が失敗しても他分野をrollbackせず、失敗分野は
 * 既存ニュースを保持して onError（Sentry想定）へ記録し次回起動へ委ねる（要件04 §6）。
 * 窓の重なりで届く同一記事は `source_url` を canonical 化した unique 制約（on conflict do nothing）で
 * 排除する。分野単位のリサーチ実行・原価台帳の冪等は researchNews 側（`ledgerKeyPrefix`）が担う。
 */

export interface NewsFetchDeps {
  db: Queryable;
  /** 1分野リサーチ。route が resolveNewsProvider＋researchNews を束ねて渡す（DB/provider配線）。 */
  researchCategory: (category: NewsCategory) => Promise<NewsResearchResult>;
  /** 分野失敗の記録（Sentry想定）。既定 no-op。 */
  onError?: (category: NewsCategory, err: unknown) => void;
  concurrency?: number;
  categories?: readonly NewsCategory[];
}

export interface NewsFetchCategoryResult {
  category: NewsCategory;
  ok: boolean;
  /** researchが返した件数。 */
  fetched: number;
  /** 重複除外後の新規保存件数。 */
  saved: number;
}

export interface NewsFetchResult {
  categories: NewsFetchCategoryResult[];
  totalSaved: number;
}

const DEFAULT_CONCURRENCY = 3;

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
      [
        category,
        item.title,
        item.summary,
        canonicalizeSourceUrl(item.source_url),
        item.impact,
        item.published_at ?? null,
      ],
    );
    if ((rowCount ?? 0) > 0) saved += 1;
  }
  return saved;
}

/** items を最大 limit 並列で worker に流す固定サイズプール。 */
async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function runNewsFetch(deps: NewsFetchDeps): Promise<NewsFetchResult> {
  const categories = deps.categories ?? NEWS_CATEGORIES;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const onError = deps.onError ?? (() => {});

  const results = await runPool(categories, concurrency, async (category) => {
    try {
      const res = await deps.researchCategory(category);
      const saved = await saveItems(deps.db, category, res.items);
      return { category, ok: true, fetched: res.items.length, saved };
    } catch (err) {
      // 分野失敗は他分野へ波及させない。既存ニュースは保持し次回起動で回復（要件04 §6）。
      onError(category, err);
      return { category, ok: false, fetched: 0, saved: 0 };
    }
  });

  return { categories: results, totalSaved: results.reduce((s, r) => s + r.saved, 0) };
}

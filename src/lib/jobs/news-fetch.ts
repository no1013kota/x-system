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
  /**
   * 分野ごとの結果を残す窓key（`news_fetch_outcomes.window_key`）。
   * 渡されたときだけ結果を保存する（テストや単体呼び出しでは省略できる）。
   */
  windowKey?: string;
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
  /**
   * 規定を満たさず除外した件数。**`fetched === 0 && dropped > 0` が「全件破棄」**で、
   * `fetched === 0 && dropped === 0` は「該当なし」。呼び出し側がこの2つを説明できるように返す。
   */
  dropped: number;
  /** 除外理由の内訳（例 `title:too_big` → 3）。 */
  dropReasons: Record<string, number>;
  /** 未来日時だったため published_at を落として取得時刻扱いへ寄せた件数。 */
  futureAdjusted: number;
}

export interface NewsFetchResult {
  categories: NewsFetchCategoryResult[];
  totalSaved: number;
  /** 0件になった分野の内訳。運営者と応答の両方で「該当なし」と「全件破棄」を区別するために持つ。 */
  emptyCategories: { category: NewsCategory; reason: "no_match" | "all_dropped" | "failed" }[];
}

/** 0件だった分野が「該当なし」「全件破棄」「失敗」のどれかを判定する（純粋関数）。 */
export function emptyReasonOf(
  r: NewsFetchCategoryResult,
): "no_match" | "all_dropped" | "failed" | null {
  if (!r.ok) return "failed";
  if (r.fetched > 0) return null;
  return r.dropped > 0 ? "all_dropped" : "no_match";
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

/**
 * 分野ごとの結果を `news_fetch_outcomes` へ残す（T-M7-40）。
 *
 * 「0件」の意味を後から説明できるようにするための記録。同一窓の再実行では上書きする
 * （受付は `cron_runs` が高々一度に絞るが、手動起動の再実行で二重行を作らないため）。
 */
async function recordOutcome(
  db: Queryable,
  windowKey: string,
  r: NewsFetchCategoryResult,
): Promise<void> {
  await db.query(
    `insert into news_fetch_outcomes
       (window_key, category, ok, fetched, saved, dropped, future_adjusted, drop_reasons)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     on conflict (window_key, category) do update
        set ok = excluded.ok, fetched = excluded.fetched, saved = excluded.saved,
            dropped = excluded.dropped, future_adjusted = excluded.future_adjusted,
            drop_reasons = excluded.drop_reasons, ran_at = now()`,
    [
      windowKey,
      r.category,
      r.ok,
      r.fetched,
      r.saved,
      r.dropped,
      r.futureAdjusted,
      JSON.stringify(r.dropReasons),
    ],
  );
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
    let outcome: NewsFetchCategoryResult;
    try {
      const res = await deps.researchCategory(category);
      const saved = await saveItems(deps.db, category, res.items);
      outcome = {
        category,
        ok: true,
        fetched: res.items.length,
        saved,
        dropped: res.dropped,
        dropReasons: res.dropReasons,
        futureAdjusted: res.futureAdjusted,
      };
    } catch (err) {
      // 分野失敗は他分野へ波及させない。既存ニュースは保持し次回起動で回復（要件04 §6）。
      onError(category, err);
      outcome = { category, ok: false, fetched: 0, saved: 0, dropped: 0, dropReasons: {}, futureAdjusted: 0 };
    }
    // 結果の保存自体が失敗しても取得結果は返す（記録のために本処理を落とさない）。
    if (deps.windowKey) {
      await recordOutcome(deps.db, deps.windowKey, outcome).catch((err) => onError(category, err));
    }
    return outcome;
  });

  const emptyCategories = results.flatMap((r) => {
    const reason = emptyReasonOf(r);
    return reason ? [{ category: r.category, reason }] : [];
  });
  return {
    categories: results,
    totalSaved: results.reduce((s, r) => s + r.saved, 0),
    emptyCategories,
  };
}

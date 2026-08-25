import { NEWS_FETCH_CATEGORIES, type NewsCategory } from "../news";
import { canonicalizeSourceUrl } from "../news-url";
import type { Queryable } from "../x/token-refresh";
import type { NewsItemOut, NewsResearchResult } from "./news-research";
import { providerFailureCode, providerRawOutputOf } from "../ai/pipeline";
import { formatFailureRawError } from "../ai/raw-error";

/**
 * news_fetch オーケストレーション（要件04 §2/§6, N-1, T-M4-11）。6分野を同時（最大6並列）にリサーチし、
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

/**
 * 既定は全6分野を同時に回す（T-M8-189/192）。3並列のままだと6分野が2巡になり、
 * 1巡目が遅い窓（web検索＋pause_turn継続で1分野100〜180秒は正当に起こる）で
 * 関数のmaxDurationを超え、**後半分野の結果とダイジェスト通知が黙って消える**。
 * 1巡＝最悪1分野ぶんの所要（≈180秒）に収めるのが目的で、費用は並列度に依存しない。
 */
const DEFAULT_CONCURRENCY = 6;

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
/**
 * 失敗の中身（T-M8-86）。**`NewsFetchCategoryResult` には載せない**——
 * `/api/cron/news-fetch` の route が結果をそのままHTTP応答へ展開するため、
 * 型に載せた時点で provider の応答本文が外へ出る（要件01 §8）。DBだけに残す。
 */
interface OutcomeFailureDetail {
  /** 短く安全な識別子（doctor に出してよい）。 */
  errorCode: string | null;
  /** providerが返した内容。画面にもHTTP応答にも出さない。 */
  providerRawError: string | null;
}

async function recordOutcome(
  db: Queryable,
  windowKey: string,
  r: NewsFetchCategoryResult,
  detail: OutcomeFailureDetail,
): Promise<void> {
  await db.query(
    `insert into news_fetch_outcomes
       (window_key, category, ok, fetched, saved, dropped, future_adjusted, drop_reasons,
        error_code, provider_raw_error)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     on conflict (window_key, category) do update
        set ok = excluded.ok, fetched = excluded.fetched, saved = excluded.saved,
            dropped = excluded.dropped, future_adjusted = excluded.future_adjusted,
            drop_reasons = excluded.drop_reasons,
            error_code = excluded.error_code,
            provider_raw_error = excluded.provider_raw_error, ran_at = now()`,
    [
      windowKey,
      r.category,
      r.ok,
      r.fetched,
      r.saved,
      r.dropped,
      r.futureAdjusted,
      JSON.stringify(r.dropReasons),
      detail.errorCode,
      detail.providerRawError,
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
  // 既定は**定時取得する分野**（全分野ではない）。費用は分野数に比例するため、
  // 運用しない分野を取りに行かない（T-M7-55）。
  const categories = deps.categories ?? NEWS_FETCH_CATEGORIES;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const onError = deps.onError ?? (() => {});

  const results = await runPool(categories, concurrency, async (category) => {
    let outcome: NewsFetchCategoryResult;
    // HTTP応答へ出さないため、結果の型ではなくローカル変数で持つ（T-M8-86）。
    let detail: OutcomeFailureDetail = { errorCode: null, providerRawError: null };
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
      /**
       * **全件破棄か、取れた数より捨てた数が多いときだけ**中身を残す。
       * 毎窓1〜2件落ちる分野で常に残すと、40日 × 分野 × 1日6回ぶんの長い値が積もる。
       * 判定は運営者向けの分類（`news-outcome.ts`）と同じ考え方で揃える。
       */
      const worthRecording =
        res.items.length === 0 ? res.dropped > 0 : res.dropped > res.items.length;
      detail = {
        errorCode: null,
        providerRawError: worthRecording ? res.providerRawError : null,
      };
    } catch (err) {
      // 分野失敗は他分野へ波及させない。既存ニュースは保持し次回起動で回復（要件04 §6）。
      onError(category, err);
      outcome = { category, ok: false, fetched: 0, saved: 0, dropped: 0, dropReasons: {}, futureAdjusted: 0 };
      // 失敗そのものの原因を残す（以前は空の行だけが残り、何が起きたか辿れなかった）。
      detail = {
        errorCode: providerFailureCode(err),
        providerRawError: formatFailureRawError(err, providerRawOutputOf(err)),
      };
    }
    // 結果の保存自体が失敗しても取得結果は返す（記録のために本処理を落とさない）。
    if (deps.windowKey) {
      await recordOutcome(deps.db, deps.windowKey, outcome, detail).catch((err) =>
        onError(category, err),
      );
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

import { z } from "zod";

import { toIsoOrNull } from "./format";
import { NEWS_CATEGORIES } from "./news";
import { AppError } from "./observability/errors";
import type { Queryable } from "./x/token-refresh";

/**
 * SC-06 ニュース一覧の中核（要件05 §6, 要件06 §10, N-2, T-M4-14／T-M8-188）。
 *
 * **新着順（取得時刻の新しい順）が基本**で、最新 `NEWS_MAX_STORED_ITEMS` 件までを
 * 50件ずつのページで返す（運営者の指示 2026-08-22）。テーマ・インパクトは**選択式のソート**：
 * 選んだ値に一致する記事が先頭へ集まり、その中と残りはそれぞれ新着順（絞り込みではない——
 * 選んでも記事は消えない）。取得は従来どおり全ユーザー共通なので、表示をどう変えても費用は
 * 変わらない。通知の条件（news_config）とは独立。
 *
 * 時間窓（from/to・最大24時間）は通知のダイジェストからの深リンク用に残す。
 * ニュースは全ユーザー共通のため本人スコープを持たない（RLSで認証済みselectを許可）。
 */

export const NEWS_PAGE_SIZE = 50;
export const NEWS_WINDOW_MAX_HOURS = 24;

/**
 * 保持・表示の上限件数（運営者の指示 2026-08-22）。一覧はこの件数までしか出さず、
 * これを超えた古い行は定時cleanup（schedule-cleanup.ts）がDBから削除する。
 */
export const NEWS_MAX_STORED_ITEMS = 500;

export const NEWS_IMPACTS = ["high", "mid", "low"] as const;

export const listNewsItemsSchema = z
  .object({
    page: z.number().int().min(1).max(10_000).optional(),
    /** 選択式ソート: このテーマの記事を先頭へ（値は news_category。未知値は弾く）。 */
    theme: z.enum(NEWS_CATEGORIES).optional(),
    /** 選択式ソート: このインパクトの記事を先頭へ。 */
    impact: z.enum(NEWS_IMPACTS).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasFrom = v.from != null;
    const hasTo = v.to != null;
    if (hasFrom !== hasTo) {
      ctx.addIssue({ code: "custom", message: "from と to は両方指定してください" });
      return;
    }
    if (hasFrom && hasTo) {
      const span = new Date(v.to as string).getTime() - new Date(v.from as string).getTime();
      if (span <= 0) {
        ctx.addIssue({ code: "custom", message: "to は from より後にしてください" });
      } else if (span > NEWS_WINDOW_MAX_HOURS * 3600 * 1000) {
        ctx.addIssue({ code: "custom", message: "時間窓は最大24時間です" });
      }
    }
  });

export type ListNewsItemsInput = z.infer<typeof listNewsItemsSchema>;

export interface NewsItemView {
  id: string;
  category: string;
  title: string;
  summary: string;
  sourceUrl: string;
  impact: string;
  publishedAt: string | null;
}

export interface NewsItemsPage {
  items: NewsItemView[];
  /** 1始まり。範囲外を要求されたら最終ページへ丸める。 */
  page: number;
  pageCount: number;
  /** 表示対象の件数（`NEWS_MAX_STORED_ITEMS` を超えない）。 */
  total: number;
}

interface NewsItemRow {
  id: string;
  category: string;
  title: string;
  summary: string;
  source_url: string;
  impact: string;
  published_at: Date | string | null;
}

/**
 * 新着順の並び。取得時刻（同一バッチ内は記事の日時）の新しい順。
 * cleanupの「最新500件」判定（schedule-cleanup.ts）と同じキーを使う。
 */
export const NEWS_ORDER_BY = "fetched_at desc, coalesce(published_at, fetched_at) desc, id desc";

/**
 * ニュースを50件ずつで返す（offsetページング・T-M8-188）。表示対象は**新着順で数えた最新
 * `NEWS_MAX_STORED_ITEMS` 件**（DB側も定時cleanupで同じ件数へ切り詰める）。theme／impact の
 * 選択があれば、その500件の中で一致する記事を先頭へ並べ替える（件数は変わらない）。
 * from/to が揃っていれば `fetched_at` の時間窓（≤24h）で絞る（ダイジェスト深リンク用）。
 */
export async function listNewsItems(
  db: Queryable,
  input: unknown = {},
): Promise<NewsItemsPage> {
  const parsed = listNewsItemsSchema.safeParse(input ?? {});
  if (!parsed.success) throw new AppError("validation_error");
  const value = parsed.data;

  const params: unknown[] = [];
  const conds: string[] = ["true"];
  if (value.from && value.to) {
    params.push(value.from, value.to);
    conds.push(
      `fetched_at >= $${params.length - 1}::timestamptz and fetched_at < $${params.length}::timestamptz`,
    );
  }

  const counted = await db.query<{ n: string }>(
    `select count(*)::text as n from news_items where ${conds.join(" and ")}`,
    params,
  );
  // 表示は最新500件まで（cleanupの削除が追いつく前でも画面の総数は一致させる）。
  const total = Math.min(Number(counted.rows[0]?.n ?? "0"), NEWS_MAX_STORED_ITEMS);
  const pageCount = Math.max(1, Math.ceil(total / NEWS_PAGE_SIZE));
  // 範囲外のページ要求は最終ページへ丸める（空ページで「消えた」と誤解させない・原則1）。
  const page = Math.min(value.page ?? 1, pageCount);

  // 選択式ソート: 一致行を先頭へ（一致・不一致の中はどちらも新着順）。
  const rank: string[] = [];
  if (value.theme) {
    params.push(value.theme);
    rank.push(`(category::text = $${params.length}) desc`);
  }
  if (value.impact) {
    params.push(value.impact);
    rank.push(`(impact::text = $${params.length}) desc`);
  }

  const offset = (page - 1) * NEWS_PAGE_SIZE;
  params.push(NEWS_MAX_STORED_ITEMS, Math.min(NEWS_PAGE_SIZE, total - offset), offset);
  const { rows } = await db.query<NewsItemRow>(
    `select id, category, title, summary, source_url, impact, published_at
       from (
         select id, category::text as category, title, summary, source_url,
                impact::text as impact, published_at, fetched_at
           from news_items
          where ${conds.join(" and ")}
          order by ${NEWS_ORDER_BY}
          limit $${params.length - 2}
       ) newest
      order by ${[...rank, NEWS_ORDER_BY].join(", ")}
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      summary: r.summary,
      sourceUrl: r.source_url,
      impact: r.impact,
      publishedAt: toIsoOrNull(r.published_at),
    })),
    page,
    pageCount,
    total,
  };
}

/**
 * ホームの重要ニュース（要件06 §1.4）: impact=high を新しい順に最大 `limit` 件。
 * 一覧（全件・ページ表示）とは目的が違うため専用に持つ（T-M8-187で一覧から絞り込みを
 * 廃止した際、ホームまで旧スキーマ入力で壊れたのを分離して直した）。
 */
export async function listTopHighImpactNews(
  db: Queryable,
  input: { categories: string[]; limit: number },
): Promise<NewsItemView[]> {
  const { rows } = await db.query<NewsItemRow>(
    `select id, category::text as category, title, summary, source_url, impact::text as impact,
            published_at
       from news_items
      where impact = 'high'
        and (cardinality($1::text[]) = 0 or category::text = any($1::text[]))
      order by coalesce(published_at, fetched_at) desc, id desc
      limit $2`,
    [input.categories, input.limit],
  );
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    summary: r.summary,
    sourceUrl: r.source_url,
    impact: r.impact,
    publishedAt: toIsoOrNull(r.published_at),
  }));
}

/**
 * 指定 news_item のうち、当該Xアカウントで既に下書き化済み（drafts.source_news_item_id）の id を返す。
 * SC-06 の「作成済み」バッジ導出用（N-4・要件06 §4.2）。
 */
export async function listCreatedNewsItemIds(
  db: Queryable,
  xAccountId: string,
  newsItemIds: string[],
): Promise<string[]> {
  if (newsItemIds.length === 0) return [];
  const { rows } = await db.query<{ source_news_item_id: string }>(
    `select distinct source_news_item_id from drafts
      where x_account_id = $1 and source_news_item_id = any($2::uuid[])`,
    [xAccountId, newsItemIds],
  );
  return rows.map((r) => r.source_news_item_id);
}

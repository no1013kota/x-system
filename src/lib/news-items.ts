import { z } from "zod";

import { DB_ENUMS } from "./db/enums";
import { AppError } from "./observability/errors";
import type { Queryable } from "./x/token-refresh";

/**
 * SC-06 ニュース一覧の中核（要件05 §6, 要件06 §10, N-2, T-M4-14）。認証済みユーザー向けに
 * `news_items` を分野・インパクトで絞り、時間窓（from/to・最大24時間）または既定の直近7日で返す。
 * 並び・keyset cursor は `coalesce(published_at, fetched_at) desc, id desc`。DBは注入し純粋に保つ。
 * ニュースは全ユーザー共通のため本人スコープを持たない（RLSで認証済みselectを許可）。
 */

export const NEWS_LIST_DEFAULT_LIMIT = 20;
export const NEWS_LIST_MAX_LIMIT = 100;
export const NEWS_WINDOW_MAX_HOURS = 24;
const DEFAULT_LOOKBACK_DAYS = 7;

const categorySchema = z.enum(DB_ENUMS.news_category as unknown as [string, ...string[]]);
const impactSchema = z.enum(DB_ENUMS.impact_level as unknown as [string, ...string[]]);

export const listNewsItemsSchema = z
  .object({
    categories: z.array(categorySchema).max(DB_ENUMS.news_category.length).optional(),
    impacts: z.array(impactSchema).max(DB_ENUMS.impact_level.length).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(NEWS_LIST_MAX_LIMIT).optional(),
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
  nextCursor: string | null;
}

interface NewsCursor {
  ts: string;
  id: string;
}

export function encodeNewsCursor(cursor: NewsCursor): string {
  return Buffer.from(`${cursor.ts}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeNewsCursor(raw: string | null | undefined): NewsCursor | null {
  if (!raw) return null;
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const sep = decoded.lastIndexOf("|");
  if (sep <= 0) return null;
  const ts = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!ts || !id) return null;
  return { ts, id };
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

interface NewsItemRow {
  id: string;
  category: string;
  title: string;
  summary: string;
  source_url: string;
  impact: string;
  published_at: Date | string | null;
  order_ts: Date | string;
}

/**
 * ニュースを新しい順に返す（keyset cursor）。入力は `listNewsItemsSchema` で検証し、from/to が
 * 揃っていれば `fetched_at` の時間窓（≤24h・ダイジェスト掲載外も含む）、無ければ直近7日で絞る。
 */
export async function listNewsItems(
  db: Queryable,
  input: unknown = {},
): Promise<NewsItemsPage> {
  const parsed = listNewsItemsSchema.safeParse(input ?? {});
  if (!parsed.success) throw new AppError("validation_error");
  const value = parsed.data;

  const limit = value.limit ?? NEWS_LIST_DEFAULT_LIMIT;
  const categories = value.categories ?? [];
  const impacts = value.impacts ?? [];
  const cursor = decodeNewsCursor(value.cursor);

  const params: unknown[] = [categories, impacts];
  const conds: string[] = [
    "(cardinality($1::text[]) = 0 or category::text = any($1::text[]))",
    "(cardinality($2::text[]) = 0 or impact::text = any($2::text[]))",
  ];
  if (value.from && value.to) {
    params.push(value.from, value.to);
    conds.push(
      `fetched_at >= $${params.length - 1}::timestamptz and fetched_at < $${params.length}::timestamptz`,
    );
  } else {
    conds.push(
      `coalesce(published_at, fetched_at) >= now() - make_interval(days => ${DEFAULT_LOOKBACK_DAYS})`,
    );
  }
  if (cursor) {
    params.push(cursor.ts, cursor.id);
    conds.push(
      `(coalesce(published_at, fetched_at), id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  params.push(limit + 1);

  const { rows } = await db.query<NewsItemRow>(
    `select id, category::text as category, title, summary, source_url, impact::text as impact,
            published_at, coalesce(published_at, fetched_at) as order_ts
       from news_items
      where ${conds.join(" and ")}
      order by coalesce(published_at, fetched_at) desc, id desc
      limit $${params.length}`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items: NewsItemView[] = page.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title,
    summary: r.summary,
    sourceUrl: r.source_url,
    impact: r.impact,
    publishedAt: toIso(r.published_at),
  }));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeNewsCursor({ ts: toIso(last.order_ts) as string, id: last.id })
      : null;
  return { items, nextCursor };
}

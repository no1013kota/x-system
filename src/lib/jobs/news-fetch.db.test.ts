import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "../db/pool";
import type { Queryable } from "../x/token-refresh";
import { runNewsFetch } from "./news-fetch";
import type { NewsItemOut, NewsResearchResult } from "./news-research";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/**
 * DB integration test for news_fetch canonical dedup (T-M4-11, 要件04 §2, ADR-0003).
 * Skips without the local Supabase stack.
 */
describe("runNewsFetch (db)", () => {
  let available = false;

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  function research(urls: string[]): NewsResearchResult {
    const items: NewsItemOut[] = urls.map((u) => ({
      title: "t",
      summary: "s",
      source_url: u,
      impact: "high",
    }));
    return { items, usage: { calls: [], estimated_cost_usd_total: 0 }, hours: 3 };
  }

  it("skips items whose canonical source_url already exists and saves new ones", async () => {
    const base = `https://news.example/${randomUUID()}`;
    const existing = `${base}/article`;
    const fresh = `${base}/fresh`;
    await withTransaction((c) =>
      c.query(
        `insert into news_items (category, title, summary, source_url, impact)
         values ('ai', 't', 's', $1, 'high')`,
        [existing],
      ),
    );
    try {
      const res = await runNewsFetch({
        db: pooledDb,
        categories: ["ai"],
        // a tracking-param variant of the existing URL (canonicalizes to `existing`) + a genuinely new URL
        researchCategory: async () => research([`${existing}?utm_source=x`, fresh]),
      });

      expect(res.categories[0].fetched).toBe(2);
      expect(res.categories[0].saved).toBe(1); // only `fresh` is new

      const rows = await withTransaction((c) =>
        c.query<{ source_url: string; n: number }>(
          `select source_url, count(*)::int as n from news_items
            where source_url = any($1) group by source_url`,
          [[existing, fresh]],
        ),
      );
      const byUrl = new Map(rows.rows.map((r) => [r.source_url, r.n]));
      expect(byUrl.get(existing)).toBe(1); // not duplicated
      expect(byUrl.get(fresh)).toBe(1); // saved
    } finally {
      await withTransaction((c) =>
        c.query(`delete from news_items where source_url = any($1)`, [[existing, fresh]]),
      );
    }
  });
});

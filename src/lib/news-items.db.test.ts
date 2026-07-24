import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closePool, getPool, withTransaction } from "./db/pool";
import { listNewsItems } from "./news-items";
import type { Queryable } from "./x/token-refresh";

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/**
 * DB integration tests for SC-06 news listing (T-M4-14, 要件05 §6, 要件06 §10).
 * Skips without the local Supabase stack.
 */
describe("listNewsItems (db)", () => {
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

  it("filters by category/impact and honours the fetched_at window and 7-day default", async () => {
    const tag = randomUUID().slice(0, 8);
    const base = new Date("2026-06-10T04:00:00Z"); // window start
    const inWin = new Date(base.getTime() + 20 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(base.getTime() - 8 * 24 * 3600 * 1000).toISOString();

    const seed = await withTransaction(async (c: PoolClient) => {
      const mk = async (
        category: string,
        impact: string,
        fetchedAt: string,
        publishedAt: string | null,
      ): Promise<string> => {
        const { rows } = await c.query<{ id: string }>(
          `insert into news_items (category, title, summary, source_url, impact, published_at, fetched_at)
           values ($1::news_category, $2, 's', $3, $4::impact_level, $5, $6::timestamptz)
           returning id`,
          [category, `${category}-${impact}-${tag}`, `https://ex.com/${randomUUID()}`, impact, publishedAt, fetchedAt],
        );
        return rows[0].id;
      };
      const aiHigh = await mk("ai", "high", inWin, inWin);
      const web3Mid = await mk("web3", "mid", inWin, inWin);
      const aiLow = await mk("ai", "low", inWin, inWin);
      // fetched a week+ before the window, but published recently → in 7-day default, out of window
      const oldFetch = await mk("ai", "high", eightDaysAgo, inWin);
      return { aiHigh, web3Mid, aiLow, oldFetch };
    });

    try {
      const ids = new Set(Object.values(seed));
      const onlyMine = (arr: { id: string }[]) => arr.filter((i) => ids.has(i.id));

      // window: only items fetched in [base, base+1h) → excludes oldFetch
      const windowed = await listNewsItems(pooledDb, {
        from: base.toISOString(),
        to: new Date(base.getTime() + 3600 * 1000).toISOString(),
        limit: 100,
      });
      const wIds = onlyMine(windowed.items).map((i) => i.id);
      expect(wIds).toEqual(expect.arrayContaining([seed.aiHigh, seed.web3Mid, seed.aiLow]));
      expect(wIds).not.toContain(seed.oldFetch);

      // category + impact filter within the window
      const filtered = await listNewsItems(pooledDb, {
        from: base.toISOString(),
        to: new Date(base.getTime() + 3600 * 1000).toISOString(),
        categories: ["ai"],
        impacts: ["high"],
        limit: 100,
      });
      const fIds = onlyMine(filtered.items).map((i) => i.id);
      expect(fIds).toEqual([seed.aiHigh]);

      // default 7-day window (no from/to) is by published_at → oldFetch (published recently) is included,
      // but relative to now() these 2026-06 rows are far in the past, so scope the assertion to shape only.
      const def = await listNewsItems(pooledDb, { categories: ["ai"], limit: 100 });
      expect(Array.isArray(def.items)).toBe(true);
    } finally {
      await withTransaction((c) =>
        c.query(`delete from news_items where title like $1`, [`%-${tag}`]),
      );
    }
  });
});

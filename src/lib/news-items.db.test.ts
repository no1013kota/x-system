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

  it("新着順固定・500件上限・時間窓（T-M8-188）", async () => {
    const tag = randomUUID().slice(0, 8);
    const base = new Date("2026-06-10T04:00:00Z");
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
      // 窓の外（8日前にfetch）。旧仕様の「直近7日」も廃止したので、窓なしでは出る。
      const oldFetch = await mk("ai", "high", eightDaysAgo, eightDaysAgo);
      return { aiHigh, web3Mid, aiLow, oldFetch };
    });

    try {
      const ids = new Set(Object.values(seed));
      const onlyMine = (arr: { id: string; category: string }[]) =>
        arr.filter((i) => ids.has(i.id));

      // 窓あり: fetched_atが[base, base+1h)のものだけ → oldFetchは出ない。
      const windowed = await listNewsItems(pooledDb, {
        from: base.toISOString(),
        to: new Date(base.getTime() + 3600 * 1000).toISOString(),
      });
      const wIds = onlyMine(windowed.items).map((i) => i.id);
      expect(wIds).toEqual(expect.arrayContaining([seed.aiHigh, seed.web3Mid, seed.aiLow]));
      expect(wIds).not.toContain(seed.oldFetch);

      // 複数選択ソート（T-M8-412）: テーマ一致（web3）→インパクト一致（low）→不一致 の順に寄る。
      // 実DBで any($::text[]) が enum 列に対して効くことまで確認する（形式の変更・CLAUDE.md）。
      const ranked = await listNewsItems(pooledDb, {
        from: base.toISOString(),
        to: new Date(base.getTime() + 3600 * 1000).toISOString(),
        themes: ["web3"],
        impacts: ["low"],
      });
      const rIds = onlyMine(ranked.items).map((i) => i.id);
      expect(rIds).toEqual([seed.web3Mid, seed.aiLow, seed.aiHigh]);

      // 窓なし: 最新500件が対象（7日制限・分野/インパクトの絞りは無い）。
      const all = await listNewsItems(pooledDb, {});
      expect(all.total).toBeGreaterThanOrEqual(Math.min(4, all.total));
      expect(all.total).toBeLessThanOrEqual(500);
      expect(all.pageCount).toBe(Math.max(1, Math.ceil(all.total / 50)));
      expect(all.pageCount).toBeLessThanOrEqual(10);

      // 新着順（fetched_at desc）: 窓の中で新しいfetchが先に並ぶ。
      const laterFetch = new Date(base.getTime() + 30 * 60 * 1000).toISOString();
      const newerId = await withTransaction(async (c: PoolClient) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into news_items (category, title, summary, source_url, impact, published_at, fetched_at)
           values ('ai'::news_category, $1, 's', $2, 'low'::impact_level, $3, $3::timestamptz)
           returning id`,
          [`newer-${tag}`, `https://ex.com/${randomUUID()}`, laterFetch],
        );
        return rows[0].id;
      });
      ids.add(newerId);
      const ordered = await listNewsItems(pooledDb, {
        from: base.toISOString(),
        to: new Date(base.getTime() + 3600 * 1000).toISOString(),
      });
      const mine = onlyMine(ordered.items).map((i) => i.id);
      expect(mine.indexOf(newerId)).toBeLessThan(mine.indexOf(seed.aiHigh));
    } finally {
      await withTransaction((c) =>
        c.query(`delete from news_items where title like $1`, [`%-${tag}`]),
      );
    }
  });});

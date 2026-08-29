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

  /**
   * T-M8-338。**Batchの取り込みが、同期実行と同じ選別・同じ記録を通る**ことを実DBで見る。
   *
   * ここがずれると「同期では捨てる記事がBatchでは残る」という、画面から説明できない差になる。
   * 失敗した分野が `news_fetch_outcomes` へ `ok=false` で残ることも同時に固定する
   * （「該当なし」と「取りに行けなかった」を混ぜない・原則1）。
   */
  it("Batchの結果を取り込み、成功分野は保存・失敗分野は理由つきで記録する", async () => {
    const { collectNewsBatch } = await import("./news-fetch");
    const windowKey = `2026-08-27T${Math.floor(Math.random() * 90) + 10}`;
    const url = `https://example.test/${randomUUID()}`;
    const submittedAt = new Date();
    const body = JSON.stringify({
      items: [
        {
          title: "見出し",
          summary: "要約",
          source_url: url,
          impact: "high",
          published_at: new Date(submittedAt.getTime() - 3_600_000).toISOString(),
        },
      ],
    });
    try {
      const res = await collectNewsBatch({
        db: pooledDb,
        windowKey,
        submittedAt,
        lookbackHours: 18,
        collected: [
          { category: "ai", ok: true, text: body, errorCode: null, usage: null },
          { category: "web3", ok: false, text: null, errorCode: "expired", usage: null },
        ],
        parseEnvelope: (text) => ({ ok: true, items: (JSON.parse(text) as { items: unknown[] }).items }),
      });
      expect(res.totalSaved).toBe(1);
      expect(res.emptyCategories).toEqual([{ category: "web3", reason: "failed" }]);

      const outcomes = (
        await pooledDb.query<{ category: string; ok: boolean; saved: number; error_code: string | null }>(
          `select category::text as category, ok, saved, error_code
             from news_fetch_outcomes where window_key = $1 order by category`,
          [windowKey],
        )
      ).rows;
      expect(outcomes).toEqual([
        { category: "ai", ok: true, saved: 1, error_code: null },
        { category: "web3", ok: false, saved: 0, error_code: "expired" },
      ]);
    } finally {
      await withTransaction((c) => c.query(`delete from news_items where source_url = $1`, [url]));
      await withTransaction((c) =>
        c.query(`delete from news_fetch_outcomes where window_key = $1`, [windowKey]),
      );
    }
  });

  function research(urls: string[]): NewsResearchResult {
    const items: NewsItemOut[] = urls.map((u) => ({
      title: "t",
      summary: "s",
      source_url: u,
      impact: "high",
    }));
    return { items, dropped: 0,
  dropReasons: {},
  futureAdjusted: 0,
  usage: { calls: [], estimated_cost_usd_total: 0 }, hours: 3, providerRawError: null };
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

  it("分野ごとの結果を実DBへ残し、同じ窓の再実行では上書きする（T-M7-40）", async () => {
    const windowKey = `test-${randomUUID().slice(0, 8)}`;
    try {
      await runNewsFetch({
        db: pooledDb,
        windowKey,
        categories: ["web3"],
        researchCategory: async () => ({
          items: [],
          dropped: 4,
          dropReasons: { "title:too_big": 4 },
          futureAdjusted: 1,
          usage: { calls: [], estimated_cost_usd_total: 0 },
          hours: 3,
          providerRawError: null,
        }),
      });

      const first = await withTransaction((c) =>
        c.query<{ fetched: number; dropped: number; future_adjusted: number; drop_reasons: Record<string, number> }>(
          `select fetched, dropped, future_adjusted, drop_reasons from news_fetch_outcomes
            where window_key = $1 and category = 'web3'`,
          [windowKey],
        ),
      );
      expect(first.rows).toHaveLength(1);
      // 0件でも「除外4件」が残るので、該当なしと全件破棄を後から区別できる。
      expect(first.rows[0].fetched).toBe(0);
      expect(first.rows[0].dropped).toBe(4);
      expect(first.rows[0].future_adjusted).toBe(1);
      expect(first.rows[0].drop_reasons["title:too_big"]).toBe(4);

      // 同じ窓を再実行しても行は増えず、最新の結果へ更新される。
      await runNewsFetch({
        db: pooledDb,
        windowKey,
        categories: ["web3"],
        researchCategory: async () => research([`https://example.com/${randomUUID()}`]),
      });
      const second = await withTransaction((c) =>
        c.query<{ n: string; fetched: number; dropped: number }>(
          `select count(*)::text as n, max(fetched) as fetched, max(dropped) as dropped
             from news_fetch_outcomes where window_key = $1 and category = 'web3'`,
          [windowKey],
        ),
      );
      expect(second.rows[0].n).toBe("1");
      expect(second.rows[0].fetched).toBe(1);
      expect(second.rows[0].dropped).toBe(0);
    } finally {
      await withTransaction((c) =>
        c.query(`delete from news_fetch_outcomes where window_key = $1`, [windowKey]),
      );
    }
  });
});

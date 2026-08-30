import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closePool, getPool } from "../db/pool";
import type { Queryable } from "../x/token-refresh";

import { runNewsRssFetch } from "./news-rss";

const db: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

/**
 * RSS巡回の実DB検証（T-M8-380。旧 news-fetch.db.test.ts の後継）。
 *
 * ここで守るのは「実際にinsertできる形か」（CHECK制約・enum・canonical重複排除）と、
 * 結果の記録（news_fetch_outcomes）が旧仕組みと同じ意味で書かれること。
 * フィードと要約は注入する（このテストは外部へ出ない）。
 */
describe("runNewsRssFetch (db)", () => {
  let available = false;
  const marker = `rss-${randomUUID().slice(0, 8)}`;
  const windowKey = `test-${marker}`;

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
      if (process.env.REQUIRE_DB) throw new Error("DBに接続できません（REQUIRE_DB=1）");
    }
  });
  afterAll(async () => {
    if (available) {
      await getPool().query(`delete from news_items where source_url like $1`, [
        `https://${marker}.example.com/%`,
      ]);
      await getPool().query(`delete from news_fetch_outcomes where window_key = $1`, [windowKey]);
    }
    await closePool();
  });

  function feedXml(paths: string[], pubDate = new Date().toUTCString()): string {
    const items = paths
      .map(
        (p) =>
          `<item><title>記事 ${p}</title><link>https://${marker}.example.com/${p}?utm_source=rss</link>` +
          `<pubDate>${pubDate}</pubDate><description>本文の抜粋 ${p}</description></item>`,
      )
      .join("");
    return `<rss version="2.0"><channel>${items}</channel></rss>`;
  }

  it("新着を要約つきで保存し、outcomeを残す。2回目はDB既存として要約を呼ばない", async () => {
    if (!available) return;
    let summarizeCalls = 0;
    const deps = {
      db,
      fetchFeed: async () => ({ ok: true, status: 200, text: feedXml(["a", "b"]) }),
      summarize: async (_c: never, articles: { url: string }[]) => {
        summarizeCalls += 1;
        return articles.map((a) => ({
          url: a.url,
          title: "要約後の見出し",
          summary: "要約後の本文。",
          impact: "high" as const,
        }));
      },
      windowKey,
      categories: ["ai"] as const,
    };
    const first = await runNewsRssFetch(deps as never);
    expect(first.totalSaved).toBe(2);
    expect(summarizeCalls).toBe(1);

    // canonical化（utm除去）されたURLで保存されている。
    const { rows } = await db.query<{ source_url: string; impact: string }>(
      `select source_url, impact::text as impact from news_items where source_url like $1 order by source_url`,
      [`https://${marker}.example.com/%`],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].source_url).toBe(`https://${marker}.example.com/a`);
    expect(rows[0].impact).toBe("high");

    // outcome が旧仕組みと同じ表へ残る。
    const outcome = await db.query<{ ok: boolean; fetched: number; saved: number }>(
      `select ok, fetched, saved from news_fetch_outcomes where window_key = $1 and category = 'ai'`,
      [windowKey],
    );
    expect(outcome.rows[0]).toMatchObject({ ok: true, fetched: 2, saved: 2 });

    // 2回目: 既知URLだけなので要約を呼ばず、保存も増えない（費用は新着にしか比例しない）。
    const second = await runNewsRssFetch(deps as never);
    expect(second.totalSaved).toBe(0);
    expect(summarizeCalls).toBe(1);
  });

  it("要約が失敗してもフィードの生情報で保存する（summary_fallback）", async () => {
    if (!available) return;
    const res = await runNewsRssFetch({
      db,
      fetchFeed: async () => ({ ok: true, status: 200, text: feedXml(["fallback"]) }),
      summarize: async () => null,
      windowKey,
      categories: ["ai"],
    } as never);
    expect(res.totalSaved).toBe(1);
    expect(res.categories[0].errorCode).toBe("summary_fallback");
    const { rows } = await db.query<{ title: string; impact: string }>(
      `select title, impact::text as impact from news_items where source_url = $1`,
      [`https://${marker}.example.com/fallback`],
    );
    expect(rows[0].title).toBe("記事 fallback");
    expect(rows[0].impact).toBe("mid");
  });

  it("全フィードが読めない分野は失敗として記録する（0件と区別する・原則1）", async () => {
    if (!available) return;
    const res = await runNewsRssFetch({
      db,
      fetchFeed: async () => ({ ok: false, status: 503, text: "" }),
      summarize: async () => [],
      windowKey,
      categories: ["ai"],
    } as never);
    expect(res.categories[0].ok).toBe(false);
    expect(res.categories[0].errorCode).toBe("feed_fetch_failed");
    expect(res.emptyCategories[0]).toEqual({ category: "ai", reason: "failed" });
    const { rows } = await db.query<{ ok: boolean; error_code: string }>(
      `select ok, error_code from news_fetch_outcomes where window_key = $1 and category = 'ai'`,
      [windowKey],
    );
    expect(rows[0]).toMatchObject({ ok: false, error_code: "feed_fetch_failed" });
  });

  it("古すぎる記事（48h+24hより前）は保存しない", async () => {
    if (!available) return;
    const old = new Date(Date.now() - 5 * 24 * 3600_000).toUTCString();
    const res = await runNewsRssFetch({
      db,
      fetchFeed: async () => ({ ok: true, status: 200, text: feedXml(["old"], old) }),
      summarize: async (_c: never, articles: { url: string }[]) =>
        articles.map((a) => ({ url: a.url, title: "t", summary: "s", impact: "low" as const })),
      windowKey,
      categories: ["ai"],
    } as never);
    expect(res.totalSaved).toBe(0);
    expect(res.categories[0].dropped).toBeGreaterThanOrEqual(1);
    expect(res.emptyCategories[0]?.reason).toBe("all_dropped");
  });
});

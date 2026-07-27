import { describe, expect, it, vi } from "vitest";

import type { NewsCategory } from "../news";
import type { Queryable } from "../x/token-refresh";
import { runNewsFetch } from "./news-fetch";
import type { NewsItemOut, NewsResearchResult } from "./news-research";

const INSERT = /insert into news_items/;

function item(url: string): NewsItemOut {
  return { title: "t", summary: "s", source_url: url, impact: "high" };
}

function research(urls: string[]): NewsResearchResult {
  return { items: urls.map(item), dropped: 0,
  dropReasons: {},
  usage: { calls: [], estimated_cost_usd_total: 0 }, hours: 3 };
}

/** mock db where a source_url in `existing` (canonical) returns rowCount 0 (on conflict). */
function mockDb(existing: Set<string> = new Set()) {
  const inserted: string[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      if (INSERT.test(sql)) {
        const url = params[3] as string; // canonical source_url
        if (existing.has(url)) return { rows: [] as T[], rowCount: 0 };
        existing.add(url);
        inserted.push(url);
        return { rows: [] as T[], rowCount: 1 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { db, inserted };
}

describe("runNewsFetch", () => {
  it("commits other categories when one fails and records the failure via onError", async () => {
    const onError = vi.fn();
    const { db } = mockDb();
    const res = await runNewsFetch({
      db,
      categories: ["ai", "web3", "investment"],
      researchCategory: async (c) => {
        if (c === "web3") throw new Error("boom");
        return research([`https://e.com/${c}`]);
      },
      onError,
    });
    const byCat = new Map(res.categories.map((r) => [r.category, r]));
    expect(byCat.get("ai")!.saved).toBe(1);
    expect(byCat.get("investment")!.saved).toBe(1);
    expect(byCat.get("web3")!.ok).toBe(false);
    expect(byCat.get("web3")!.saved).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe("web3");
    expect(res.totalSaved).toBe(2);
  });

  it("does not save items whose canonical source_url already exists", async () => {
    const { db, inserted } = mockDb(new Set(["https://e.com/dup"]));
    const res = await runNewsFetch({
      db,
      categories: ["ai"],
      // canonicalized: dup collapses (utm stripped), new stays
      researchCategory: async () =>
        research(["https://e.com/dup?utm_source=x", "https://e.com/fresh"]),
    });
    expect(res.categories[0].fetched).toBe(2);
    expect(res.categories[0].saved).toBe(1);
    expect(inserted).toEqual(["https://e.com/fresh"]);
  });

  it("runs at most `concurrency` categories in parallel", async () => {
    const { db } = mockDb();
    let active = 0;
    let maxActive = 0;
    const cats: NewsCategory[] = ["ai", "web3", "investment", "business", "business_ops", "sns"];
    const res = await runNewsFetch({
      db,
      categories: cats,
      concurrency: 3,
      researchCategory: async (c) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return research([`https://e.com/${c}`]);
      },
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1); // actually parallelised
    expect(res.totalSaved).toBe(6);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { NewsCategory } from "../news";
import type { Queryable } from "../x/token-refresh";
import { emptyReasonOf, runNewsFetch } from "./news-fetch";
import type { NewsItemOut, NewsResearchResult } from "./news-research";

const INSERT = /insert into news_items/;

function item(url: string): NewsItemOut {
  return { title: "t", summary: "s", source_url: url, impact: "high" };
}

function research(urls: string[]): NewsResearchResult {
  return { items: urls.map(item), dropped: 0,
  dropReasons: {},
  futureAdjusted: 0,
  usage: { calls: [], estimated_cost_usd_total: 0 }, hours: 3, providerRawError: null };
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


describe("0件の意味を区別できる（T-M7-40）", () => {
  // 2026-07-31、web3・snsが0件になったが、応答からは「該当ニュースが無かった」のか
  // 「取得したが全件破棄した」のか分からなかった。除外理由はログにしか出ていなかった。
  const base = { category: "ai" as NewsCategory, ok: true, saved: 0, dropReasons: {}, futureAdjusted: 0 };

  it("該当なし（0件・除外0）と全件破棄（0件・除外あり）を別の値で表す", () => {
    expect(emptyReasonOf({ ...base, fetched: 0, dropped: 0 })).toBe("no_match");
    expect(emptyReasonOf({ ...base, fetched: 0, dropped: 3, dropReasons: { "title:too_big": 3 } })).toBe(
      "all_dropped",
    );
    expect(emptyReasonOf({ ...base, ok: false, fetched: 0, dropped: 0 })).toBe("failed");
    expect(emptyReasonOf({ ...base, fetched: 2, dropped: 1 }), "取れていれば0件ではない").toBeNull();
  });

  it("結果に除外件数・理由と、0件分野の内訳を載せる", async () => {
    const { db } = mockDb();
    const res = await runNewsFetch({
      db,
      categories: ["ai", "web3"] as NewsCategory[],
      researchCategory: async (category) =>
        category === "ai"
          ? research(["https://example.com/a"])
          : {
              items: [],
              dropped: 4,
              dropReasons: { "title:too_big": 4 },
              futureAdjusted: 0,
              usage: { calls: [], estimated_cost_usd_total: 0 },
              hours: 3,
              providerRawError: null,
            },
    });
    const web3 = res.categories.find((c) => c.category === "web3");
    expect(web3?.dropped).toBe(4);
    expect(web3?.dropReasons["title:too_big"]).toBe(4);
    expect(res.emptyCategories).toEqual([{ category: "web3", reason: "all_dropped" }]);
  });

  it("windowKey を渡すと分野ごとの結果を保存する", async () => {
    const saved: unknown[][] = [];
    const db: Queryable = {
      query: async <T = unknown>(sql: string, params: unknown[] = []) => {
        if (/insert into news_fetch_outcomes/.test(sql)) saved.push(params);
        return { rows: [] as T[], rowCount: 1 };
      },
    };
    await runNewsFetch({
      db,
      windowKey: "2026-07-31T13",
      categories: ["ai"] as NewsCategory[],
      researchCategory: async () => research(["https://example.com/a"]),
    });
    expect(saved).toHaveLength(1);
    expect(saved[0][0]).toBe("2026-07-31T13");
    expect(saved[0][1]).toBe("ai");
  });

  it("結果の保存に失敗しても取得結果は返す（記録のために本処理を落とさない）", async () => {
    const errors: unknown[] = [];
    const db: Queryable = {
      query: async <T = unknown>(sql: string) => {
        if (/insert into news_fetch_outcomes/.test(sql)) throw new Error("記録失敗");
        return { rows: [] as T[], rowCount: 1 };
      },
    };
    const res = await runNewsFetch({
      db,
      windowKey: "w1",
      categories: ["ai"] as NewsCategory[],
      researchCategory: async () => research(["https://example.com/a"]),
      onError: (_c, err) => errors.push(err),
    });
    expect(res.totalSaved).toBe(1);
    expect(errors).toHaveLength(1);
  });
});

/**
 * 失敗の中身をDBへ残し、**HTTP応答へは出さない**（T-M8-86）。
 *
 * `/api/cron/news-fetch` の route は結果をそのまま応答へ展開するため、
 * 型に載せた時点で provider の応答本文が外へ出る（要件01 §8）。
 */
describe("ニュース取得の失敗記録", () => {
  it("結果の型に応答本文を持たない（HTTP応答へ漏れない）", async () => {
    const { runNewsFetch } = await import("./news-fetch");
    const writes: { sql: string; params: unknown[] }[] = [];
    const db = {
      async query(sql: string, params?: unknown[]) {
        writes.push({ sql, params: params ?? [] });
        return { rows: [], rowCount: 0 };
      },
    };
    const result = await runNewsFetch({
      db,
      windowKey: "w1",
      categories: ["ai"],
      researchCategory: async () => {
        throw new Error("boom");
      },
      onError: () => {},
    } as never);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("providerRawError");
    expect(serialized).not.toContain("provider_raw_error");
    expect(serialized, "応答本文が漏れている").not.toContain("boom");

    // DBへは残す（運営者が原因を辿れる経路は保つ）。
    const insert = writes.find((w) => w.sql.includes("insert into news_fetch_outcomes"));
    expect(insert, "結果を記録していない").toBeDefined();
    expect(String(insert?.params.at(-1) ?? ""), "応答本文が保存されていない").toContain("boom");
    expect(String(insert?.params.at(-2) ?? ""), "失敗の種別が保存されていない").toBe("Error");
  });
});

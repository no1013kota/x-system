import { describe, expect, it } from "vitest";

import { listNewsItems } from "./news-items";
import { AppError } from "./observability/errors";
import type { Queryable } from "./x/token-refresh";

type Row = Record<string, unknown>;

function mockDb(rows: Row[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: rows as T[], rowCount: rows.length };
    },
  };
  return { db, calls };
}

const now = "2026-07-24T05:00:00Z";
const win = (h: number) => new Date(Date.parse(now) + h * 3600 * 1000).toISOString();

describe("listNewsItems validation", () => {
  it("rejects a limit outside 1..100", async () => {
    const { db } = mockDb();
    await expect(listNewsItems(db, { limit: 0 })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { limit: 101 })).rejects.toBeInstanceOf(AppError);
  });

  it("rejects an unknown category or impact", async () => {
    const { db } = mockDb();
    await expect(listNewsItems(db, { categories: ["nope"] })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { impacts: ["huge"] })).rejects.toBeInstanceOf(AppError);
  });

  it("requires from and to together", async () => {
    const { db } = mockDb();
    await expect(listNewsItems(db, { from: now })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { to: now })).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a window wider than 24h or non-positive", async () => {
    const { db } = mockDb();
    await expect(listNewsItems(db, { from: now, to: win(25) })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { from: win(1), to: now })).rejects.toBeInstanceOf(AppError);
  });

  it("accepts a valid 24h window", async () => {
    const { db } = mockDb();
    await expect(listNewsItems(db, { from: now, to: win(24) })).resolves.toBeDefined();
  });
});

describe("listNewsItems query", () => {
  it("filters by fetched_at window when from/to are given (not the 7-day default)", async () => {
    const { db, calls } = mockDb();
    await listNewsItems(db, { from: now, to: win(6) });
    const sql = calls[0].sql;
    expect(sql).toMatch(/fetched_at >= \$3::timestamptz and fetched_at < \$4::timestamptz/);
    expect(sql).not.toMatch(/make_interval\(days =>/);
    expect(calls[0].params[2]).toBe(now);
    expect(calls[0].params[3]).toBe(win(6));
  });

  it("uses the 7-day default window when no from/to is given", async () => {
    const { db, calls } = mockDb();
    await listNewsItems(db, { categories: ["ai"], impacts: ["high"] });
    expect(calls[0].sql).toMatch(/coalesce\(published_at, fetched_at\) >= now\(\) - make_interval\(days => 7\)/);
    expect(calls[0].params[0]).toEqual(["ai"]);
    expect(calls[0].params[1]).toEqual(["high"]);
  });

  it("returns nextCursor only when more than `limit` rows exist", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      category: "ai",
      title: `t${i}`,
      summary: "s",
      source_url: "https://e.com/x",
      impact: "high",
      published_at: "2026-07-24T00:00:00.000Z",
      order_ts: "2026-07-24T00:00:00.000Z",
    }));
    const { db } = mockDb(rows);
    const page = await listNewsItems(db, { limit: 2 });
    expect(page.items).toHaveLength(2); // limit applied (limit+1 fetched, sliced)
    expect(page.nextCursor).not.toBeNull();
  });
});

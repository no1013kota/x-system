import { describe, expect, it } from "vitest";

import { NEWS_PAGE_SIZE, listNewsItems } from "./news-items";
import { AppError } from "./observability/errors";
import type { Queryable } from "./x/token-refresh";

type Row = Record<string, unknown>;

/** 1回目（count）と2回目（rows）で別の結果を返すモック。 */
function mockDb(total: number, rows: Row[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("count(*)")) {
        return { rows: [{ n: String(total) }] as T[], rowCount: 1 };
      }
      return { rows: rows as T[], rowCount: rows.length };
    },
  };
  return { db, calls };
}

const now = "2026-07-24T05:00:00Z";
const win = (h: number) => new Date(Date.parse(now) + h * 3600 * 1000).toISOString();

describe("listNewsItems validation（T-M8-187）", () => {
  it("未知のsort・0以下のpage・旧入力（limit等）は弾く", async () => {
    const { db } = mockDb(0);
    await expect(listNewsItems(db, { sort: "likes" })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { page: 0 })).rejects.toBeInstanceOf(AppError);
    // 旧スキーマの入力は受け付けない（呼び出し側の直し忘れをここで止める）。
    await expect(listNewsItems(db, { limit: 20 })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { categories: ["ai"] })).rejects.toBeInstanceOf(AppError);
  });

  it("from/toは両方そろえる・窓は最大24時間", async () => {
    const { db } = mockDb(0);
    await expect(listNewsItems(db, { from: now })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { from: now, to: win(25) })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { from: win(1), to: now })).rejects.toBeInstanceOf(AppError);
    await expect(listNewsItems(db, { from: now, to: win(24) })).resolves.toBeDefined();
  });
});

describe("listNewsItems query（T-M8-187）", () => {
  it("既定は絞り込みなし・新着順・50件offset", async () => {
    const { db, calls } = mockDb(0);
    const page = await listNewsItems(db, {});
    const sql = calls[1].sql;
    // 期間・分野・インパクトで絞らない（保存されている全件が対象）。
    expect(sql).not.toMatch(/make_interval|category::text = any|impact::text = any/);
    expect(sql).toMatch(/order by coalesce\(published_at, fetched_at\) desc, id desc/);
    expect(calls[1].params).toEqual([NEWS_PAGE_SIZE, 0]);
    expect(page).toMatchObject({ page: 1, pageCount: 1, total: 0, sort: "date" });
  });

  it("sort=categoryはテーマ順→新着、sort=impactは高→中→低→新着", async () => {
    const { db, calls } = mockDb(0);
    await listNewsItems(db, { sort: "category" });
    expect(calls[1].sql).toMatch(/order by category asc, coalesce\(published_at, fetched_at\) desc/);
    await listNewsItems(db, { sort: "impact" });
    expect(calls[3].sql).toMatch(
      /case impact::text when 'high' then 0 when 'mid' then 1 else 2 end asc/,
    );
  });

  it("ページはoffsetで進み、範囲外は最終ページへ丸める", async () => {
    const { db, calls } = mockDb(120);
    const page = await listNewsItems(db, { page: 3 });
    expect(page).toMatchObject({ page: 3, pageCount: 3, total: 120 });
    expect(calls[1].params).toEqual([NEWS_PAGE_SIZE, 100]);

    const clamped = await listNewsItems(db, { page: 99 });
    expect(clamped.page).toBe(3); // 空ページで「消えた」と誤解させない
  });

  it("from/toはfetched_atの時間窓で絞る（ダイジェスト深リンク用）", async () => {
    const { db, calls } = mockDb(0);
    await listNewsItems(db, { from: now, to: win(6) });
    expect(calls[0].sql).toMatch(/fetched_at >= \$1::timestamptz and fetched_at < \$2::timestamptz/);
  });
});

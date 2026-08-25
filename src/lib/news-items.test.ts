import { describe, expect, it } from "vitest";

import { NEWS_MAX_STORED_ITEMS, NEWS_PAGE_SIZE, listNewsItems } from "./news-items";
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

describe("listNewsItems validation（T-M8-188）", () => {
  it("0以下のpage・旧入力（sort・limit等）は弾く", async () => {
    const { db } = mockDb(0);
    await expect(listNewsItems(db, { page: 0 })).rejects.toBeInstanceOf(AppError);
    // 旧スキーマの入力は受け付けない（呼び出し側の直し忘れをここで止める）。
    await expect(listNewsItems(db, { sort: "impact" })).rejects.toBeInstanceOf(AppError);
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

describe("listNewsItems query（T-M8-188）", () => {
  it("既定は絞り込みなし・新着順（取得時刻）・50件offset", async () => {
    const { db, calls } = mockDb(10);
    const page = await listNewsItems(db, {});
    const sql = calls[1].sql;
    // 期間・分野・インパクトで絞らない（最新500件が対象）。
    expect(sql).not.toMatch(/make_interval|category::text = any|impact::text = any/);
    expect(sql).toMatch(
      /order by fetched_at desc, coalesce\(published_at, fetched_at\) desc, id desc/,
    );
    // [500件の窓, 残り件数だけのlimit, offset]。
    expect(calls[1].params).toEqual([NEWS_MAX_STORED_ITEMS, 10, 0]);
    expect(page).toMatchObject({ page: 1, pageCount: 1, total: 10 });
  });

  it("テーマ・インパクトを選ぶと一致行が先頭へ並ぶ（絞り込みはしない）", async () => {
    const { db, calls } = mockDb(10);
    await listNewsItems(db, { theme: "ai", impact: "high" });
    const sql = calls[1].sql;
    // where では絞らず（where true のみ）、order by の一致判定で先頭へ寄せる。
    expect(sql).toMatch(/where true\n/);
    expect(sql).toMatch(/order by \(category::text = \$1\) desc, \(impact::text = \$2\) desc/);
    expect(calls[1].params.slice(0, 2)).toEqual(["ai", "high"]);
    // 未知のテーマは弾く（selectの選択肢とzodの語彙がズレたら気付けるように）。
    await expect(listNewsItems(db, { theme: "unknown" })).rejects.toBeInstanceOf(AppError);
  });

  it("ページはoffsetで進み、範囲外は最終ページへ丸める", async () => {
    const { db, calls } = mockDb(120);
    const page = await listNewsItems(db, { page: 3 });
    expect(page).toMatchObject({ page: 3, pageCount: 3, total: 120 });
    expect(calls[1].params).toEqual([NEWS_MAX_STORED_ITEMS, 20, 100]); // 最終ページは残り20件だけ読む

    const clamped = await listNewsItems(db, { page: 99 });
    expect(clamped.page).toBe(3); // 空ページで「消えた」と誤解させない
  });

  it("総数が500件を超えても、表示は最新500件（10ページ）で打ち切る", async () => {
    const { db, calls } = mockDb(1234);
    const page = await listNewsItems(db, { page: 10 });
    expect(page).toMatchObject({ page: 10, pageCount: 10, total: NEWS_MAX_STORED_ITEMS });
    expect(calls[1].params).toEqual([NEWS_MAX_STORED_ITEMS, NEWS_PAGE_SIZE, 450]);
    const clamped = await listNewsItems(db, { page: 11 });
    expect(clamped.page).toBe(10);
  });

  it("from/toはfetched_atの時間窓で絞る（ダイジェスト深リンク用）", async () => {
    const { db, calls } = mockDb(0);
    await listNewsItems(db, { from: now, to: win(6) });
    expect(calls[0].sql).toMatch(/fetched_at >= \$1::timestamptz and fetched_at < \$2::timestamptz/);
  });
});

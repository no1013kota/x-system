import { describe, expect, it, vi } from "vitest";

import { cleanupOldData } from "./schedule-cleanup";
import type { Queryable } from "../x/token-refresh";

type Row = Record<string, unknown>;

const NEWS_NOTIF = /delete from notifications[\s\S]*type = 'news'/;
const NEWS_ITEMS = /delete from news_items/;
const USAGE = /delete from external_api_usage_events/;
const CRON = /delete from cron_runs/;
const IMG_LIST = /from storage\.objects o/;
const IMG_RECHECK = /select 1 from drafts d\s+where d\.images @> jsonb_build_array\(jsonb_build_object\('storage_path', \$1/;

function makeDb(handler: (sql: string, params: unknown[]) => { rows?: Row[]; rowCount?: number }) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      writes.push({ sql, params });
      const r = handler(sql, params);
      return { rows: (r.rows ?? []) as T[], rowCount: r.rowCount ?? r.rows?.length ?? 0 };
    },
  };
  return { db, writes };
}

describe("cleanupOldData", () => {
  it("deletes retention data in order (news notif → news_items → usage → cron_runs)", async () => {
    const { db, writes } = makeDb((sql) => {
      if (NEWS_NOTIF.test(sql)) return { rowCount: 3 };
      if (NEWS_ITEMS.test(sql)) return { rowCount: 2 };
      if (USAGE.test(sql)) return { rowCount: 5 };
      if (CRON.test(sql)) return { rowCount: 1 };
      return { rows: [] };
    });
    const res = await cleanupOldData({ db });
    expect(res).toMatchObject({ newsNotifications: 3, newsItems: 2, usageEvents: 5, cronRuns: 1, images: 0 });
    const order = writes
      .map((w, i) => ({ i, kind: NEWS_NOTIF.test(w.sql) ? "n" : NEWS_ITEMS.test(w.sql) ? "i" : USAGE.test(w.sql) ? "u" : CRON.test(w.sql) ? "c" : "" }))
      .filter((x) => x.kind)
      .map((x) => x.kind);
    expect(order).toEqual(["n", "i", "u", "c"]);
  });

  it("skips image cleanup when no storage remover is provided", async () => {
    const { db, writes } = makeDb(() => ({ rows: [] }));
    await cleanupOldData({ db });
    expect(writes.some((w) => IMG_LIST.test(w.sql))).toBe(false);
  });

  it("removes only images that are still unreferenced at the pre-delete re-check", async () => {
    const remove = vi.fn(async () => {});
    const { db } = makeDb((sql, params) => {
      if (IMG_LIST.test(sql)) return { rows: [{ name: "a" }, { name: "b" }, { name: "c" }] };
      if (IMG_RECHECK.test(sql)) return { rowCount: params[0] === "a" ? 1 : 0 }; // 'a' got referenced
      return { rows: [] };
    });
    const res = await cleanupOldData({
      db,
      imageBucket: "generated-images",
      removeStorageObjects: remove,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(["b", "c"]);
    expect(res.images).toBe(2);
  });

  it("does not call remove when every candidate is referenced at re-check", async () => {
    const remove = vi.fn(async () => {});
    const { db } = makeDb((sql) => {
      if (IMG_LIST.test(sql)) return { rows: [{ name: "a" }] };
      if (IMG_RECHECK.test(sql)) return { rowCount: 1 };
      return { rows: [] };
    });
    const res = await cleanupOldData({ db, imageBucket: "b", removeStorageObjects: remove });
    expect(remove).not.toHaveBeenCalled();
    expect(res.images).toBe(0);
  });

  it("isolates a failing step and records it via onError without aborting the rest", async () => {
    const onError = vi.fn();
    const { db } = makeDb((sql) => {
      if (NEWS_ITEMS.test(sql)) throw new Error("boom");
      if (USAGE.test(sql)) return { rowCount: 4 };
      return { rowCount: 0 };
    });
    const res = await cleanupOldData({ db, onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe("news_items");
    expect(res.usageEvents).toBe(4); // steps after the failure still ran
  });
});

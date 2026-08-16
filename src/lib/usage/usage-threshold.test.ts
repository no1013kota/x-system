import { describe, expect, it } from "vitest";

import type { Queryable } from "../x/token-refresh";
import { notifyUsageThresholds } from "./usage-threshold";

/**
 * notifyUsageThresholds の閾値判定（T-M6-13, 要件03 §8）。80%＝ceil(limit×0.8)・100%＝limit 以上で
 * 通知挿入を試みる（dedupe は DB の unique 制約が担保）。ここでは挿入試行の (key, threshold) を検証する。
 */
function makeDb() {
  const inserts: { key: unknown; threshold: unknown }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(_sql: string, params: unknown[] = []) => {
      inserts.push({ key: params[1], threshold: params[2] });
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { db, inserts };
}

describe("notifyUsageThresholds", () => {
  it("inserts nothing below 80%", async () => {
    const { db, inserts } = makeDb();
    await notifyUsageThresholds(db, { userId: "u1", key: "ai_credits", newCount: 799 }); // 80% of 1000 = 800
    expect(inserts).toHaveLength(0);
  });

  it("inserts only the 80% notification at exactly 80%", async () => {
    const { db, inserts } = makeDb();
    await notifyUsageThresholds(db, { userId: "u1", key: "ai_credits", newCount: 800 });
    expect(inserts).toEqual([{ key: "ai_credits", threshold: 80 }]);
  });

  it("inserts both 80% and 100% notifications at the limit", async () => {
    const { db, inserts } = makeDb();
    await notifyUsageThresholds(db, { userId: "u1", key: "normal_posts", newCount: 200 });
    expect(inserts).toEqual([
      { key: "normal_posts", threshold: 80 },
      { key: "normal_posts", threshold: 100 },
    ]);
  });

  it("uses ceil(limit×0.8) as the 80% boundary for url_posts (20→16)", async () => {
    const below = makeDb();
    await notifyUsageThresholds(below.db, { userId: "u1", key: "url_posts", newCount: 15 });
    expect(below.inserts).toHaveLength(0);
    const at = makeDb();
    await notifyUsageThresholds(at.db, { userId: "u1", key: "url_posts", newCount: 16 });
    expect(at.inserts).toEqual([{ key: "url_posts", threshold: 80 }]);
  });
});

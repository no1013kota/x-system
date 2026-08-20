import { describe, expect, it } from "vitest";

import type { Queryable } from "../x/token-refresh";
import { notifyUsageThresholds } from "./usage-threshold";

/**
 * notifyUsageThresholds の閾値判定（T-M6-13, 要件03 §8）。80%＝ceil(limit×0.8)・100%＝limit 以上で
 * 通知挿入を試みる（dedupe は DB の unique 制約が担保）。ここでは挿入試行の (key, threshold) を検証する。
 */
function makeDb(plan: string | null = "premium") {
  const inserts: { key: unknown; threshold: unknown }[] = [];
  const db: Queryable = {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      // 上限はプランから引く（T-M8-168）。同一tx内で profiles を1行読む。
      if (/select plan from profiles/.test(sql)) {
        return { rows: [{ plan }] as T[], rowCount: 1 };
      }
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

  /**
   * 利用枠を画面に出さないプラン（エキスパート・T-M8-168）には**通知自体を作らない**。
   * 「上限の80%」という通知が内部ガード値を漏らすため。到達時の見せ方は
   * 常設バナーと usage_paused（一時停止の文言）が担う。
   */
  it("エキスパートには閾値通知を作らない（数値を漏らさない）", async () => {
    const { db, inserts } = makeDb("expert");
    // expertの内部上限（ai_credits 5000）に達していても通知しない。
    await notifyUsageThresholds(db, { userId: "u1", key: "ai_credits", newCount: 5000 });
    expect(inserts).toHaveLength(0);
  });

  it("BYOK（standard）と未契約には通知を作らない（枠が無い）", async () => {
    for (const plan of ["standard", null]) {
      const { db, inserts } = makeDb(plan);
      await notifyUsageThresholds(db, { userId: "u1", key: "ai_credits", newCount: 999999 });
      expect(inserts, String(plan)).toHaveLength(0);
    }
  });
});

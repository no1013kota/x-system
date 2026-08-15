import { describe, expect, it } from "vitest";

import {
  SUGGEST_ANALYZE_MAX,
  TIMELINE_BACKFILL_DAYS,
  TIMELINE_FETCH_MAX,
  TIMELINE_REFRESH_OVERLAP_H,
  timelineFetchStart,
  truncateForStore,
  TIMELINE_TEXT_MAX_CHARS,
} from "./suggestion-timeline";

/**
 * 増分取得の窓の決定（T-M8-94）。
 * ここを間違えると (a) 毎回全量を取り直して費用が跳ねる (b) 重なりが無く直近投稿の
 * メトリクスが「取得した朝の値」で凍結される、のどちらかに静かに倒れる。
 */

const NOW = Date.UTC(2026, 7, 15, 23, 0, 0); // JST 2026-08-16 08:00

describe("timelineFetchStart", () => {
  it("初回（保存なし）は30日前から", () => {
    expect(timelineFetchStart(null, NOW)).toBe(
      new Date(NOW - TIMELINE_BACKFILL_DAYS * 86_400_000).toISOString(),
    );
  });

  it("保存があれば最新投稿の48時間前から（メトリクスを取り直す重なり）", () => {
    const newest = new Date(NOW - 5 * 86_400_000).toISOString(); // 5日前
    expect(timelineFetchStart(newest, NOW)).toBe(
      new Date(Date.parse(newest) - TIMELINE_REFRESH_OVERLAP_H * 3_600_000).toISOString(),
    );
  });

  it("最新投稿が30日以上前でも、30日より昔へは遡らない（metricsの提供範囲外）", () => {
    const old = new Date(NOW - 40 * 86_400_000).toISOString();
    expect(timelineFetchStart(old, NOW)).toBe(
      new Date(NOW - TIMELINE_BACKFILL_DAYS * 86_400_000).toISOString(),
    );
  });

  it("読めない値は初回扱い（窓を壊して全量課金へ倒さない）", () => {
    expect(timelineFetchStart("not-a-date", NOW)).toBe(
      new Date(NOW - TIMELINE_BACKFILL_DAYS * 86_400_000).toISOString(),
    );
  });
});

describe("truncateForStore", () => {
  it("上限以内はそのまま", () => {
    expect(truncateForStore("短い本文")).toBe("短い本文");
  });

  it("絵文字を割らずに500字で切る", () => {
    const long = "🎉".repeat(TIMELINE_TEXT_MAX_CHARS + 10);
    const cut = truncateForStore(long);
    expect([...cut]).toHaveLength(TIMELINE_TEXT_MAX_CHARS);
    expect(cut).not.toContain("�");
  });
});

describe("上限の固定（変えると費用が変わる）", () => {
  it("1回の取得は最大100件（×$0.005 = 取得費用の上限$0.50）", () => {
    expect(TIMELINE_FETCH_MAX).toBe(100);
  });

  it("分析に渡すのは新しい順に最大300件（AI入力の上限）", () => {
    expect(SUGGEST_ANALYZE_MAX).toBe(300);
  });
});

import { describe, expect, it } from "vitest";

import { PLANS } from "../plans";
import {
  computeUsageSummary,
  formatNextMonthStartJst,
  nextMonthStartJst,
  type UsageCounters,
} from "./usage-summary";

const LIMITS = PLANS.premium.usageLimits!;

function counters(over: Partial<UsageCounters> = {}): UsageCounters {
  return { normal_posts_count: 0, url_posts_count: 0, ai_credits_used: 0, ...over };
}

describe("computeUsageSummary (要件03 §8)", () => {
  it("produces used/limit/remaining for the three slots (AIクレジットは金額制・T-M8-109)", () => {
    const s = computeUsageSummary(
      counters({ normal_posts_count: 38, url_posts_count: 8, ai_credits_used: 220 }),
      LIMITS,
    );
    expect(s).toEqual({
      ai_credits: { used: 220, limit: 1000, remaining: 780 },
      normal_posts: { used: 38, limit: 200, remaining: 162 },
      url_posts: { used: 8, limit: 20, remaining: 12 },
    });
  });

  it("clamps remaining at 0 when over the limit and reflects 上限到達", () => {
    // AIクレジットは精算の追加消費で上限を超え得る（拒否せず計上する・T-M8-109）。
    const s = computeUsageSummary(
      counters({ normal_posts_count: 205, url_posts_count: 20, ai_credits_used: 1010 }),
      LIMITS,
    );
    expect(s.normal_posts.remaining).toBe(0); // 205 > 200 → 0（負数にしない）
    expect(s.url_posts.remaining).toBe(0); // 20 == 20 → 0（上限到達）
    expect(s.ai_credits.remaining).toBe(0);
  });
});

describe("nextMonthStartJst / formatNextMonthStartJst (翌月開始日時)", () => {
  it("returns the first day of the next JST month at 00:00 JST", () => {
    // 2026-07-25T10:00Z = JST 2026-07-25 19:00 → 翌月開始 = 2026-08-01 00:00 JST = 2026-07-31 15:00Z
    const reset = nextMonthStartJst(new Date("2026-07-25T10:00:00Z"));
    expect(reset.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(formatNextMonthStartJst(new Date("2026-07-25T10:00:00Z"))).toBe("2026年8月1日");
  });

  it("rolls over December to the next January (JST)", () => {
    // 2026-12-20T00:00Z = JST 2026-12-20 09:00 → 翌月開始 = 2027-01-01 00:00 JST = 2026-12-31 15:00Z
    const reset = nextMonthStartJst(new Date("2026-12-20T00:00:00Z"));
    expect(reset.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(formatNextMonthStartJst(new Date("2026-12-20T00:00:00Z"))).toBe("2027年1月1日");
  });

  it("uses the JST calendar month even near UTC month boundaries", () => {
    // 2026-07-31T20:00Z = JST 2026-08-01 05:00 → 既に8月 → 翌月開始 = 2026-09-01 00:00 JST
    expect(formatNextMonthStartJst(new Date("2026-07-31T20:00:00Z"))).toBe("2026年9月1日");
  });
});

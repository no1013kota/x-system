import { describe, expect, it } from "vitest";

import { TEXT_DEFAULT_ESTIMATE_CREDITS } from "../ai/model-catalog";

import { PLANS } from "../plans";
import {
  computeUsageSummary,
  usageResetLabel,
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
      ai_credits: { used: 220, limit: 100_000, remaining: 99_780 },
      normal_posts: { used: 38, limit: 200, remaining: 162 },
      url_posts: { used: 8, limit: 20, remaining: 12 },
      concealed: false,
      paused: false,
      resetsAt: null,
    });
  });

  it("上限到達で paused になる（バナー・カードはこのフラグだけを見る）", () => {
    const s = computeUsageSummary(counters({ normal_posts_count: 200 }), LIMITS);
    expect(s.paused).toBe(true);
  });

  /**
   * concealed（エキスパート・T-M8-168）は数値をゼロ埋めして返す。
   * 設定画面は summary を client component（Flight payload）へ渡すため、
   * UI側で隠すだけでは view-source に内部ガード値が載る。
   */
  it("concealed は数値をゼロ埋めし、内部ガード値を持ち出さない", () => {
    const limits = PLANS.expert.usageLimits!;
    const s = computeUsageSummary(
      counters({ normal_posts_count: 38, ai_credits_used: 220 }),
      limits,
      { concealed: true },
    );
    const empty = { used: 0, limit: 0, remaining: 0 };
    expect(s).toEqual({
      ai_credits: empty,
      normal_posts: empty,
      url_posts: empty,
      concealed: true,
      paused: false,
      resetsAt: null,
    });
  });

  /**
   * 実行は「AIクレジット残が1回分の見積もりに満たない」段階で止まる（operatorBudgetOk/reserve）。
   * 停止表示（paused）も同じ段階で立てないと、止まっているのに画面が何も言わない期間ができる
   * （エキスパートは数値も閾値通知も無いため、この表示が唯一の気付く経路・原則1）。
   */
  it("concealed はAIクレジット残が1回分の見積もり未満で paused になる", () => {
    const limits = PLANS.expert.usageLimits!;
    const nearlyOut = computeUsageSummary(
      counters({ ai_credits_used: limits.aiCredits - (TEXT_DEFAULT_ESTIMATE_CREDITS - 1) }), // 残りが1回分に満たない
      limits,
      { concealed: true },
    );
    expect(nearlyOut.paused).toBe(true);
    const enough = computeUsageSummary(
      counters({ ai_credits_used: limits.aiCredits - TEXT_DEFAULT_ESTIMATE_CREDITS }), // ちょうど1回分
      limits,
      { concealed: true },
    );
    expect(enough.paused).toBe(false);
  });

  it("clamps remaining at 0 when over the limit and reflects 上限到達", () => {
    // AIクレジットは精算の追加消費で上限を超え得る（拒否せず計上する・T-M8-109）。
    const s = computeUsageSummary(
      counters({ normal_posts_count: 205, url_posts_count: 20, ai_credits_used: 101_000 }),
      LIMITS,
    );
    expect(s.normal_posts.remaining).toBe(0); // 205 > 200 → 0（負数にしない）
    expect(s.url_posts.remaining).toBe(0); // 20 == 20 → 0（上限到達）
    expect(s.ai_credits.remaining).toBe(0);
  });
});

describe("usageResetLabel（次回更新日・T-M8-258）", () => {
  it("契約の次回更新日を JST の日付で出す（UTC の日付では1日ずれる）", () => {
    // 2026-09-30T15:00Z = 10/1 00:00 JST
    expect(usageResetLabel({ resetsAt: "2026-09-30T15:00:00Z" })).toBe("2026年10月1日");
  });

  it("日付が無い・壊れているときは存在しない日付を作らない", () => {
    expect(usageResetLabel({ resetsAt: null })).toBe("次回の更新日");
    expect(usageResetLabel({ resetsAt: "not-a-date" })).toBe("次回の更新日");
  });
});

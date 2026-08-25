import { describe, expect, it } from "vitest";

import { judgeAffiliatePayouts } from "./affiliate-payout-status";

/**
 * 振込は運営者の手作業なので、期限を知らせる経路が無いと支払いが記憶頼みになる
 * （T-M8-241・CLAUDE.md 原則3）。
 */
const now = new Date("2026-09-20T00:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe("judgeAffiliatePayouts", () => {
  it("未払いが無ければ ok", () => {
    expect(judgeAffiliatePayouts({ pending: 0, netTotal: 0, dueAt: null }, now)).toMatchObject({
      level: "ok",
    });
  });

  it("期限まで余裕があれば ok（件数と金額は必ず出す）", () => {
    const check = judgeAffiliatePayouts(
      { pending: 2, netTotal: 12340, dueAt: inDays(20) },
      now,
    );
    expect(check.level).toBe("ok");
    expect(check.detail).toContain("未払い 2 件");
    expect(check.detail).toContain("¥12,340");
  });

  it("期限まで7日を切ったら warn（次の一手つき）", () => {
    const check = judgeAffiliatePayouts({ pending: 1, netTotal: 5000, dueAt: inDays(3) }, now);
    expect(check.level).toBe("warn");
    expect(check.detail).toContain("あと 3 日");
    expect(check.nextAction).toContain("affiliate:payouts");
  });

  it("期限を過ぎていたら error", () => {
    const check = judgeAffiliatePayouts({ pending: 1, netTotal: 5000, dueAt: inDays(-2) }, now);
    expect(check.level).toBe("error");
    expect(check.detail).toContain("2 日過ぎ");
  });

  it("期限が読めないときは warn（黙って ok にしない）", () => {
    expect(
      judgeAffiliatePayouts({ pending: 1, netTotal: 100, dueAt: "not-a-date" }, now).level,
    ).toBe("warn");
  });
});

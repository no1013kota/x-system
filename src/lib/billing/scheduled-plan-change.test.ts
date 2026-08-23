import { describe, expect, it } from "vitest";

import { scheduledPlanChangeLabel } from "./scheduled-plan-change";

describe("scheduledPlanChangeLabel (T-M8-260)", () => {
  it("予約先と切替日が揃っていれば日本時間の日付つきで文を返す", () => {
    // 2026-09-30T15:00Z = 10/1 00:00 JST。UTCの日付で出すと1日ずれる。
    expect(
      scheduledPlanChangeLabel({ scheduled_plan: "standard", scheduled_plan_at: "2026-09-30T15:00:00Z" }),
    ).toBe("2026年10月1日にスタンダードプランへ切り替わる予約があります");
  });

  it("予約が無ければ null", () => {
    expect(scheduledPlanChangeLabel({ scheduled_plan: null, scheduled_plan_at: null })).toBeNull();
    expect(scheduledPlanChangeLabel({ scheduled_plan: "standard", scheduled_plan_at: null })).toBeNull();
  });
});

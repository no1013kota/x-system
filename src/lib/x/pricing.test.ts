import { describe, expect, it } from "vitest";

import { xUnitCost, type XCostConfig } from "./pricing";

const cfg: XCostConfig = {
  contentCreateUsd: 0.01,
  contentCreateWithUrlUsd: 0.02,
  interactionDeleteUsd: 0.005,
  postReadUsd: 0.005,
  userReadUsd: 0.01,
};

describe("xUnitCost", () => {
  it("prices post creation by URL presence", () => {
    expect(xUnitCost("x_post_create", cfg)).toBe(0.01);
    expect(xUnitCost("x_post_create", cfg, { hasUrl: false })).toBe(0.01);
    expect(xUnitCost("x_post_create", cfg, { hasUrl: true })).toBe(0.02);
  });

  it("prices post deletion at the interaction rate", () => {
    expect(xUnitCost("x_post_delete", cfg)).toBe(0.005);
  });

  it("読取の単価も設定から返す（T-M8-91。0固定だと台帳の費用が実費より小さく見える）", () => {
    // pay-per-usage は応答の resource 1件ごとに課金する（Posts $0.005 / User $0.010）。
    expect(xUnitCost("x_post_read", cfg)).toBe(cfg.postReadUsd);
    expect(xUnitCost("x_user_read", cfg)).toBe(cfg.userReadUsd);
  });
});

import { describe, expect, it } from "vitest";

import { xUnitCost, type XCostConfig } from "./pricing";

const cfg: XCostConfig = {
  contentCreateUsd: 0.01,
  contentCreateWithUrlUsd: 0.02,
  interactionDeleteUsd: 0.005,
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

  it("prices reads at zero (no configured X cost)", () => {
    expect(xUnitCost("x_post_read", cfg)).toBe(0);
    expect(xUnitCost("x_user_read", cfg)).toBe(0);
  });
});

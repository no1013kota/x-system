import { describe, expect, it } from "vitest";

import { createDeadline } from "./deadline";

describe("createDeadline", () => {
  it("tracks remaining time against an injected clock", () => {
    let t = 0;
    const d = createDeadline(180_000, () => t);
    expect(d.remainingMs()).toBe(180_000);
    t = 100_000;
    expect(d.remainingMs()).toBe(80_000);
    t = 200_000;
    expect(d.remainingMs()).toBe(-20_000);
  });

  it("allows starting a call only with >=30s headroom", () => {
    let t = 0;
    const d = createDeadline(180_000, () => t);
    t = 150_000; // 30s left
    expect(d.canStartCall()).toBe(true);
    t = 150_001; // <30s left
    expect(d.canStartCall()).toBe(false);
  });

  it("caps per-call timeout at min(90s, remaining)", () => {
    let t = 0;
    const d = createDeadline(180_000, () => t);
    t = 50_000; // 130s left → capped to 90s
    expect(d.callTimeoutMs()).toBe(90_000);
    t = 160_000; // 20s left → 20s
    expect(d.callTimeoutMs()).toBe(20_000);
    t = 190_000; // past deadline → 0 (never negative)
    expect(d.callTimeoutMs()).toBe(0);
  });
});

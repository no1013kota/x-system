import { describe, expect, it } from "vitest";

import {
  MAX_ATTEMPTS,
  backoffMs,
  isRetryable,
  shouldRetry,
  type ErrorKind,
} from "./retry";

describe("isRetryable", () => {
  it("retries transient errors only", () => {
    const retry: ErrorKind[] = ["rate_limit", "server", "network"];
    const noRetry: ErrorKind[] = ["auth", "invalid", "unknown"];
    for (const k of retry) expect(isRetryable(k)).toBe(true);
    for (const k of noRetry) expect(isRetryable(k)).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows exponentially with no jitter (rng=0)", () => {
    const z = () => 0;
    expect(backoffMs(1, z)).toBe(1000);
    expect(backoffMs(2, z)).toBe(2000);
    expect(backoffMs(3, z)).toBe(4000);
  });

  it("caps at 30s", () => {
    const z = () => 0;
    expect(backoffMs(10, z)).toBe(30_000);
  });

  it("adds jitter up to half of the exponential term", () => {
    const max = () => 0.999999;
    // attempt 2: exp=2000, jitter≈1000 → ~2999
    const v = backoffMs(2, max);
    expect(v).toBeGreaterThanOrEqual(2000);
    expect(v).toBeLessThanOrEqual(3000);
  });
});

describe("shouldRetry", () => {
  it("retries transient errors below the attempt cap", () => {
    expect(shouldRetry("server", 1)).toBe(true);
    expect(shouldRetry("server", 2)).toBe(true);
    expect(shouldRetry("server", MAX_ATTEMPTS)).toBe(false); // 3 → stop
    expect(shouldRetry("auth", 1)).toBe(false); // non-retryable
  });
});

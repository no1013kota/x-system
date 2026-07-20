import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isValidCronAuth } from "./auth";

describe("isValidCronAuth", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("accepts the exact Bearer token", () => {
    expect(isValidCronAuth("Bearer test-secret")).toBe(true);
  });

  it("rejects missing, wrong, or malformed headers", () => {
    expect(isValidCronAuth(null)).toBe(false);
    expect(isValidCronAuth(undefined)).toBe(false);
    expect(isValidCronAuth("")).toBe(false);
    expect(isValidCronAuth("Bearer wrong")).toBe(false);
    expect(isValidCronAuth("test-secret")).toBe(false); // no Bearer prefix
    expect(isValidCronAuth("Bearer test-secret ")).toBe(false); // trailing space
  });

  it("denies when CRON_SECRET is unset (no fallback)", () => {
    delete process.env.CRON_SECRET;
    expect(isValidCronAuth("Bearer anything")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  LOCK_CLASS,
  cronWindowLockKey,
  hash32,
  postPublishLockKey,
  xAccountLockKey,
} from "./locks";

describe("hash32", () => {
  it("is deterministic and fits signed int32", () => {
    const a = hash32("abc");
    expect(hash32("abc")).toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(a).toBeLessThanOrEqual(2 ** 31 - 1);
  });

  it("differs for different inputs", () => {
    expect(hash32("a")).not.toBe(hash32("b"));
  });
});

describe("lock key derivation", () => {
  it("namespaces by class and is deterministic", () => {
    expect(xAccountLockKey("x1")).toEqual([LOCK_CLASS.xAccount, hash32("x1")]);
    expect(postPublishLockKey("u1")).toEqual([
      LOCK_CLASS.postPublish,
      hash32("u1"),
    ]);
    expect(cronWindowLockKey("news_fetch", "2026-07-20T09")).toEqual([
      LOCK_CLASS.cron,
      hash32("news_fetch:2026-07-20T09"),
    ]);
  });

  it("gives different keys across classes even for the same id", () => {
    const x = xAccountLockKey("same");
    const p = postPublishLockKey("same");
    expect(x[0]).not.toBe(p[0]); // different classid
  });

  it("gives the same key for the same input (stable across calls)", () => {
    expect(xAccountLockKey("acc-123")).toEqual(xAccountLockKey("acc-123"));
    expect(cronWindowLockKey("j", "w")).toEqual(cronWindowLockKey("j", "w"));
  });
});

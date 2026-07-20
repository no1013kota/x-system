import { describe, expect, it } from "vitest";

import { fiveMinWindowKey, hourWindowKey } from "./cron";

describe("window keys (UTC)", () => {
  it("hourWindowKey truncates to the hour", () => {
    const d = new Date("2026-07-20T10:37:45.000Z");
    expect(hourWindowKey(d)).toBe("2026-07-20T10");
  });

  it("fiveMinWindowKey floors to the 5-minute bucket", () => {
    expect(fiveMinWindowKey(new Date("2026-07-20T10:37:45.000Z"))).toBe(
      "2026-07-20T10:35",
    );
    expect(fiveMinWindowKey(new Date("2026-07-20T10:00:00.000Z"))).toBe(
      "2026-07-20T10:00",
    );
    expect(fiveMinWindowKey(new Date("2026-07-20T10:34:59.000Z"))).toBe(
      "2026-07-20T10:30",
    );
  });
});

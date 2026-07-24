import { describe, expect, it } from "vitest";

import { isValidXPostUrl, parseXPostUrl } from "./x-url";

describe("parseXPostUrl", () => {
  it("accepts x.com/twitter.com status URLs", () => {
    expect(parseXPostUrl("https://x.com/jack/status/12345")).toEqual({
      handle: "jack",
      statusId: "12345",
    });
    expect(parseXPostUrl("https://twitter.com/user_1/status/999")).toEqual({
      handle: "user_1",
      statusId: "999",
    });
  });

  it("accepts a www. host prefix", () => {
    expect(parseXPostUrl("https://www.x.com/a/status/1")).toEqual({
      handle: "a",
      statusId: "1",
    });
  });

  it("rejects non-X hosts", () => {
    expect(parseXPostUrl("https://evil.com/jack/status/1")).toBeNull();
    expect(parseXPostUrl("https://x.com.evil.com/jack/status/1")).toBeNull();
  });

  it("rejects malformed paths", () => {
    expect(parseXPostUrl("https://x.com/jack/statuses/1")).toBeNull();
    expect(parseXPostUrl("https://x.com/jack/status/abc")).toBeNull();
    expect(parseXPostUrl("https://x.com/jack")).toBeNull();
    expect(parseXPostUrl("https://x.com/jack/status/1/extra")).toBeNull();
  });

  it("rejects an over-long handle", () => {
    expect(parseXPostUrl(`https://x.com/${"a".repeat(16)}/status/1`)).toBeNull();
  });

  it("rejects non-URLs and non-http(s) schemes", () => {
    expect(parseXPostUrl("not a url")).toBeNull();
    expect(parseXPostUrl("javascript:alert(1)")).toBeNull();
  });

  it("isValidXPostUrl mirrors parse", () => {
    expect(isValidXPostUrl("https://x.com/a/status/1")).toBe(true);
    expect(isValidXPostUrl("https://x.com/a")).toBe(false);
  });
});

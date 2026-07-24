import { describe, expect, it } from "vitest";

import { canonicalizeSourceUrl } from "./news-url";

describe("canonicalizeSourceUrl", () => {
  it("strips tracking params (utm_*/fbclid/…) and the fragment, keeping real params", () => {
    expect(canonicalizeSourceUrl("https://a.com/x?utm_source=t&id=5&fbclid=z#frag")).toBe(
      "https://a.com/x?id=5",
    );
  });

  it("lowercases scheme/host, drops default port and trailing slash", () => {
    expect(canonicalizeSourceUrl("https://A.COM:443/x/")).toBe("https://a.com/x");
  });

  it("collapses bare host variants", () => {
    expect(canonicalizeSourceUrl("https://a.com")).toBe("https://a.com");
    expect(canonicalizeSourceUrl("https://a.com/?utm_medium=e")).toBe("https://a.com");
  });

  it("sorts remaining query params for a stable key", () => {
    expect(canonicalizeSourceUrl("https://a.com/x?b=2&a=1")).toBe("https://a.com/x?a=1&b=2");
  });

  it("returns the trimmed input when it is not a valid URL", () => {
    expect(canonicalizeSourceUrl("  not a url  ")).toBe("not a url");
  });
});

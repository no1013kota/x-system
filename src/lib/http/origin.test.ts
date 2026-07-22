import { describe, expect, it } from "vitest";

import { hasExactAppOrigin } from "./origin";

describe("hasExactAppOrigin", () => {
  it("accepts only the canonical application origin", () => {
    expect(hasExactAppOrigin("https://app.example.com", "https://app.example.com")).toBe(
      true,
    );
    expect(
      hasExactAppOrigin("https://app.example.com", "https://app.example.com/path"),
    ).toBe(true);
  });

  it("rejects missing, malformed, or merely prefixed origins", () => {
    expect(hasExactAppOrigin(null, "https://app.example.com")).toBe(false);
    expect(hasExactAppOrigin("https://app.example.com/", "https://app.example.com")).toBe(
      false,
    );
    expect(
      hasExactAppOrigin("https://app.example.com.evil.test", "https://app.example.com"),
    ).toBe(false);
    expect(hasExactAppOrigin("https://app.example.com", "not-a-url")).toBe(false);
  });
});

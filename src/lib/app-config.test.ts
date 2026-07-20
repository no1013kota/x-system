import { describe, expect, it } from "vitest";

import { APP_DESCRIPTION, APP_NAME } from "./app-config";

describe("app-config", () => {
  it("defines the product name", () => {
    expect(APP_NAME).toBe("Space AI");
  });

  it("defines a non-empty description", () => {
    expect(APP_DESCRIPTION.length).toBeGreaterThan(0);
  });
});

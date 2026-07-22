import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("Next.js security config", () => {
  it("does not log serialized Server Function arguments", () => {
    expect(nextConfig.logging).not.toBe(false);
    expect(nextConfig.logging && nextConfig.logging.serverFunctions).toBe(false);
  });
});

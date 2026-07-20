import { describe, expect, it } from "vitest";

import { childJobKey, requestKey } from "./keys";

describe("childJobKey", () => {
  it("builds the deterministic parent-scoped key", () => {
    expect(childJobKey("job-1", "image_generation", "draft-9")).toBe(
      "parent:job-1:image_generation:draft-9",
    );
    // stable across calls
    expect(childJobKey("p", "post_publish", "d")).toBe(
      childJobKey("p", "post_publish", "d"),
    );
  });
});

describe("requestKey", () => {
  it("prefixes the user id to the client token", () => {
    expect(requestKey("user-1", "tok-abc")).toBe("user-1:tok-abc");
  });

  it("is stable for the same (userId, token)", () => {
    expect(requestKey("u", "t")).toBe(requestKey("u", "t"));
  });

  it("generates a unique token when none is given", () => {
    const a = requestKey("u");
    const b = requestKey("u");
    expect(a).not.toBe(b);
    expect(a.startsWith("u:")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { AppError, toUserFacingError, userMessageForCode } from "./errors";

describe("toUserFacingError", () => {
  it("maps an AppError to its code and safe message", () => {
    const e = new AppError("usage_limit_exceeded");
    expect(toUserFacingError(e)).toEqual({
      code: "usage_limit_exceeded",
      message: userMessageForCode("usage_limit_exceeded"),
    });
  });

  it("includes author-controlled details when present", () => {
    const e = new AppError("api_key_required", {
      details: { missing: ["anthropic"], settingsPath: "/app/settings" },
    });
    const out = toUserFacingError(e);
    expect(out.code).toBe("api_key_required");
    expect(out.details).toEqual({
      missing: ["anthropic"],
      settingsPath: "/app/settings",
    });
  });

  it("collapses unknown errors to internal_error without leaking detail", () => {
    const raw = new Error("provider said: secret stack trace at line 42");
    const out = toUserFacingError(raw);
    expect(out.code).toBe("internal_error");
    expect(out.message).toBe(userMessageForCode("internal_error"));
    // the raw message / stack must not appear in the user-facing output
    expect(JSON.stringify(out)).not.toContain("secret stack trace");
    expect(out).not.toHaveProperty("details");
  });

  it("does not expose the cause chain to users", () => {
    const e = new AppError("provider_error", {
      cause: new Error("HTTP 500 body: {api_key: sk-xxx}"),
    });
    const out = toUserFacingError(e);
    expect(JSON.stringify(out)).not.toContain("sk-xxx");
  });
});

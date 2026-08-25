import { describe, expect, it } from "vitest";

import { turnstileWidgetVisibilityOptions } from "./turnstile-widget-options";

describe("turnstileWidgetVisibilityOptions", () => {
  it("uses Cloudflare's supported interaction-only appearance", () => {
    expect(turnstileWidgetVisibilityOptions(true)).toEqual({
      appearance: "interaction-only",
    });
  });

  it("leaves the normal visible widget unchanged", () => {
    expect(turnstileWidgetVisibilityOptions(false)).toEqual({});
  });
});

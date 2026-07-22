import { describe, expect, it } from "vitest";

import {
  revalidateByokAiPurposeConfig,
  resolvePremiumTextPurpose,
  updateAiPurposeConfigSchema,
} from "./ai-purpose-config";

describe("AI purpose lifecycle", () => {
  it("resolves Premium text to Anthropic without reading persisted config", () => {
    expect(resolvePremiumTextPurpose()).toBe("anthropic");
  });

  it("keeps only valid BYOK providers and preserves future fields", () => {
    expect(
      revalidateByokAiPurposeConfig(
        { image: "google", text: "anthropic", future: { enabled: true } },
        new Set(["anthropic", "google"]),
      ),
    ).toEqual({
      future: { enabled: true },
      image: "google",
      text: "anthropic",
    });
  });

  it("clears missing, invalid, and image-incompatible providers", () => {
    expect(
      revalidateByokAiPurposeConfig(
        { image: "anthropic", text: "openai" },
        new Set(["anthropic"]),
      ),
    ).toEqual({ image: null, text: null });
    expect(revalidateByokAiPurposeConfig(null, new Set())).toEqual({
      image: null,
      text: null,
    });
  });

  it("accepts partial nullable updates and rejects Anthropic for image", () => {
    expect(updateAiPurposeConfigSchema.safeParse({ text: "openai" }).success).toBe(
      true,
    );
    expect(updateAiPurposeConfigSchema.safeParse({ image: null }).success).toBe(
      true,
    );
    expect(updateAiPurposeConfigSchema.safeParse({}).success).toBe(false);
    expect(
      updateAiPurposeConfigSchema.safeParse({ image: "anthropic" }).success,
    ).toBe(false);
  });
});

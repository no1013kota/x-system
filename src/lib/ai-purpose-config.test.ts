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
      image_model: null,
      text: "anthropic",
      text_model: null,
    });
  });

  it("clears missing, invalid, and image-incompatible providers", () => {
    expect(
      revalidateByokAiPurposeConfig(
        { image: "anthropic", text: "openai" },
        new Set(["anthropic"]),
      ),
    ).toEqual({ image: null, image_model: null, text: null, text_model: null });
    expect(revalidateByokAiPurposeConfig(null, new Set())).toEqual({
      image: null,
      image_model: null,
      text: null,
      text_model: null,
    });
  });

  it("providerが有効ならモデル選択を保持し、無効になったらモデルも外す（T-M8-107）", () => {
    expect(
      revalidateByokAiPurposeConfig(
        { text: "anthropic", text_model: "claude-fable-5", image: "openai", image_model: "gpt-image-2" },
        new Set(["anthropic"]),
      ),
    ).toEqual({ text: "anthropic", text_model: "claude-fable-5", image: null, image_model: null });
  });

  it("スキーマはカタログ外のモデルを拒否し、カタログ内は受ける（T-M8-107）", () => {
    expect(
      updateAiPurposeConfigSchema.safeParse({ text: "anthropic", text_model: "claude-fable-5" }).success,
    ).toBe(true);
    expect(
      updateAiPurposeConfigSchema.safeParse({ text: "anthropic", text_model: "not-a-model" }).success,
    ).toBe(false);
    expect(
      updateAiPurposeConfigSchema.safeParse({ image: "openai", image_model: "gpt-image-2" }).success,
    ).toBe(true);
    // providerと不一致のモデルは拒否（openaiのモデルをgoogleへ等）
    expect(
      updateAiPurposeConfigSchema.safeParse({ image: "google", image_model: "gpt-image-2" }).success,
    ).toBe(false);
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

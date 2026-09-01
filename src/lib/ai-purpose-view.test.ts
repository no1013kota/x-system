import { describe, expect, it } from "vitest";

import {
  buildAiPurposeProviderOptions,
  configuredPurpose,
  defaultImageProvider,
} from "./ai-purpose-view";

describe("AI purpose settings view", () => {
  it("shows only valid BYOK providers and excludes Anthropic from images", () => {
    expect(
      buildAiPurposeProviderOptions({
        operatorImageProviders: ["google"],
        plan: "standard",
        validUserProviders: ["google", "anthropic"],
      }),
    ).toEqual({ image: ["google"], text: ["anthropic", "google"] });
  });

  it("makes Premium text read-only and limits images to operator keys", () => {
    expect(
      buildAiPurposeProviderOptions({
        operatorImageProviders: ["google"],
        plan: "premium",
        validUserProviders: ["openai"],
      }),
    ).toEqual({ image: ["google"], text: [] });
  });

  it("drops a configured provider when it is no longer available", () => {
    const config = { image: "openai", text: "anthropic" };
    expect(configuredPurpose(config, "text", ["anthropic"])).toBe("anthropic");
    expect(configuredPurpose(config, "image", ["google"])).toBeNull();
  });
});

describe("defaultImageProvider (T-M8-401)", () => {
  it("OpenAIが使えればOpenAI（既定モデル GPT Image 1.5 の provider）", () => {
    expect(defaultImageProvider(["google", "openai"])).toBe("openai");
  });
  it("OpenAIが無ければ使える先頭、何も無ければ null", () => {
    expect(defaultImageProvider(["google"])).toBe("google");
    expect(defaultImageProvider([])).toBeNull();
  });
});

import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { ProviderConfigError } from "./normalize";
import {
  isImageProvider,
  isTextKind,
  isTextProvider,
  resolveImageKey,
  resolveNewsKey,
  resolveTextKey,
  type ResolveConfig,
} from "./resolve-provider";

/** A client that throws if queried — proves premium-text/news paths don't touch the DB. */
const noDbClient = {
  query: () => {
    throw new Error("DB should not be queried on this path");
  },
} as unknown as PoolClient;

/**
 * A client that returns a profile row with the given ai_purpose_config.
 * Used for premium image, which honors the user's openai/google selection.
 */
function profileClient(
  aiPurposeConfig: Record<string, unknown> | null,
): PoolClient {
  return {
    query: async (sql: string) => {
      if (/from profiles/.test(sql)) {
        return {
          rows:
            aiPurposeConfig === null
              ? []
              : [{ ai_purpose_config: aiPurposeConfig }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  } as unknown as PoolClient;
}

const decrypt = () => {
  throw new Error("decrypt should not be called on operator paths");
};

function config(overrides: Partial<ResolveConfig> = {}): ResolveConfig {
  return {
    premiumTextProvider: "anthropic",
    newsTextProvider: "anthropic",
    operatorApiKeys: { anthropic: "op-anthropic", openai: "op-openai", google: "op-google" },
    textModels: { anthropic: "a-model", openai: "o-model", google: "g-model" },
    imageModels: { openai: "o-img", google: "g-img" },
    ...overrides,
  };
}

describe("classifiers", () => {
  it("isTextKind covers the text-producing kinds only", () => {
    expect(isTextKind("post_generation")).toBe(true);
    expect(isTextKind("learning_analysis")).toBe(true);
    expect(isTextKind("md_merge")).toBe(true);
    expect(isTextKind("suggestion")).toBe(true);
    expect(isTextKind("image_generation")).toBe(false);
    expect(isTextKind("post_publish")).toBe(false);
  });
  it("isImageProvider is openai/google only", () => {
    expect(isImageProvider("openai")).toBe(true);
    expect(isImageProvider("google")).toBe(true);
    expect(isImageProvider("anthropic")).toBe(false);
  });
  it("isTextProvider excludes non-text api_provider values ('x', typos)", () => {
    expect(isTextProvider("anthropic")).toBe(true);
    expect(isTextProvider("openai")).toBe(true);
    expect(isTextProvider("google")).toBe(true);
    expect(isTextProvider("x")).toBe(false);
    expect(isTextProvider("gpt")).toBe(false);
  });
});

describe("resolveTextKey — premium (operator, ignores user config)", () => {
  it("fixes to Anthropic on the operator key (provider is not user-selectable)", async () => {
    // T-M8-107以降、モデル選択を読むためDBは参照する。providerは引き続き運営固定。
    const key = await resolveTextKey(
      { plan: "premium", userId: "u1" },
      { client: profileClient({ text: "openai" }), decrypt, config: config() },
    );
    expect(key).toEqual({
      provider: "anthropic",
      keySource: "operator",
      apiKey: "op-anthropic",
      model: "a-model",
    });
  });

  it("premiumでもユーザー選択のモデル（カタログ内）を尊重する（T-M8-107）", async () => {
    const key = await resolveTextKey(
      { plan: "premium", userId: "u1" },
      { client: profileClient({ text_model: "claude-fable-5" }), decrypt, config: config() },
    );
    expect(key.model).toBe("claude-fable-5");
  });

  it("カタログ外のモデル指定はenv既定へフォールバックする（未知IDを実APIへ送らない）", async () => {
    const key = await resolveTextKey(
      { plan: "premium", userId: "u1" },
      { client: profileClient({ text_model: "claude-nonexistent-9" }), decrypt, config: config() },
    );
    expect(key.model).toBe("a-model");
  });

  it("honors an explicit operator provider override", async () => {
    const key = await resolveTextKey(
      { plan: "premium", userId: "u1" },
      {
        client: profileClient({}),
        decrypt,
        config: config({ premiumTextProvider: "openai" }),
      },
    );
    expect(key.provider).toBe("openai");
    expect(key.apiKey).toBe("op-openai");
  });

  it("throws ProviderConfigError when the operator key is missing", async () => {
    await expect(
      resolveTextKey(
        { plan: "premium", userId: "u1" },
        {
          client: noDbClient,
          decrypt,
          config: config({ operatorApiKeys: { openai: "x", google: "y" } }),
        },
      ),
    ).rejects.toBeInstanceOf(ProviderConfigError);
  });
});

describe("resolveNewsKey — operator, no implicit switch", () => {
  it("resolves NEWS_TEXT_PROVIDER on the operator key", () => {
    const key = resolveNewsKey(config({ newsTextProvider: "anthropic" }));
    expect(key).toEqual({
      provider: "anthropic",
      keySource: "operator",
      apiKey: "op-anthropic",
      model: "a-model",
    });
  });

  it("fails (no auto-switch) when the configured provider's key is unset", () => {
    expect(() =>
      resolveNewsKey(
        config({ newsTextProvider: "openai", operatorApiKeys: { anthropic: "op-anthropic" } }),
      ),
    ).toThrow(ProviderConfigError);
  });
});

describe("resolveImageKey — premium honors the user's openai/google selection", () => {
  it("uses the user-selected provider (google) on the operator key", async () => {
    const key = await resolveImageKey(
      { plan: "premium", userId: "u1" },
      { client: profileClient({ image: "google" }), decrypt, config: config() },
    );
    expect(key).toMatchObject({
      provider: "google",
      keySource: "operator",
      model: "g-img",
    });
  });

  it("uses the user-selected provider (openai)", async () => {
    const key = await resolveImageKey(
      { plan: "premium", userId: "u1" },
      { client: profileClient({ image: "openai" }), decrypt, config: config() },
    );
    expect(key.provider).toBe("openai");
    expect(key.keySource).toBe("operator");
  });

  it("falls back to an available operator provider (openai) when unselected", async () => {
    const key = await resolveImageKey(
      { plan: "premium", userId: "u1" },
      { client: profileClient({ image: null }), decrypt, config: config() },
    );
    expect(key.provider).toBe("openai");
  });

  it("falls back when the stored value is not an image provider", async () => {
    const key = await resolveImageKey(
      { plan: "premium", userId: "u1" },
      { client: profileClient({ image: "anthropic" }), decrypt, config: config() },
    );
    expect(key.provider).toBe("openai");
  });

  it("throws ProviderConfigError when the selected provider's operator key/model is unconfigured", async () => {
    await expect(
      resolveImageKey(
        { plan: "premium", userId: "u1" },
        {
          client: profileClient({ image: "google" }),
          decrypt,
          config: config({
            operatorApiKeys: { openai: "op-openai" },
            imageModels: { openai: "o-img" },
          }),
        },
      ),
    ).rejects.toBeInstanceOf(ProviderConfigError);
  });

  it("throws ProviderConfigError when no operator image provider is configured", async () => {
    await expect(
      resolveImageKey(
        { plan: "premium", userId: "u1" },
        {
          client: profileClient({ image: null }),
          decrypt,
          config: config({ operatorApiKeys: { anthropic: "op-anthropic" }, imageModels: {} }),
        },
      ),
    ).rejects.toBeInstanceOf(ProviderConfigError);
  });
});

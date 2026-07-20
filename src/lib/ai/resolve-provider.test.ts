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

/** A client that throws if queried — proves premium/news paths don't touch the DB. */
const noDbClient = {
  query: () => {
    throw new Error("DB should not be queried on this path");
  },
} as unknown as PoolClient;

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
  it("fixes to PREMIUM_TEXT_PROVIDER on the operator key without touching the DB", async () => {
    const key = await resolveTextKey(
      { plan: "premium", userId: "u1" },
      { client: noDbClient, decrypt, config: config() },
    );
    expect(key).toEqual({
      provider: "anthropic",
      keySource: "operator",
      apiKey: "op-anthropic",
      model: "a-model",
    });
  });

  it("honors an explicit PREMIUM_TEXT_PROVIDER override", async () => {
    const key = await resolveTextKey(
      { plan: "premium", userId: "u1" },
      { client: noDbClient, decrypt, config: config({ premiumTextProvider: "openai" }) },
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

describe("resolveImageKey — premium picks an available operator openai/google", () => {
  it("prefers openai when both are available", async () => {
    const key = await resolveImageKey(
      { plan: "premium", userId: "u1" },
      { client: noDbClient, decrypt, config: config() },
    );
    expect(key).toMatchObject({ provider: "openai", keySource: "operator", model: "o-img" });
  });

  it("falls back to google when openai has no operator key", async () => {
    const key = await resolveImageKey(
      { plan: "premium", userId: "u1" },
      {
        client: noDbClient,
        decrypt,
        config: config({ operatorApiKeys: { google: "op-google" } }),
      },
    );
    expect(key.provider).toBe("google");
  });

  it("throws ProviderConfigError when no operator image provider is configured", async () => {
    await expect(
      resolveImageKey(
        { plan: "premium", userId: "u1" },
        {
          client: noDbClient,
          decrypt,
          config: config({ operatorApiKeys: { anthropic: "op-anthropic" } }),
        },
      ),
    ).rejects.toBeInstanceOf(ProviderConfigError);
  });
});

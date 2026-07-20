import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decryptWithKey, encryptWithKey } from "../crypto/envelope";
import { closePool, getPool, withTransaction } from "../db/pool";
import { ProviderConfigError } from "./normalize";
import {
  ApiKeyRequiredError,
  resolveImageKey,
  resolveTextKey,
  type ResolveConfig,
  type ResolveDeps,
} from "./resolve-provider";

/**
 * DB integration tests for BYOK resolution (T-M0-19). Inserts profiles +
 * user_api_keys with envelope-encrypted keys and a test key injected as decrypt.
 * Skips without the local Supabase stack.
 */
describe("resolveTextKey / resolveImageKey — BYOK (local DB)", () => {
  let available = false;
  const testKey = randomBytes(32);
  const decrypt = (serialized: string) => decryptWithKey(serialized, testKey);

  const config: ResolveConfig = {
    premiumTextProvider: "anthropic",
    newsTextProvider: "anthropic",
    operatorApiKeys: {},
    textModels: { anthropic: "a-model", openai: "o-model", google: "g-model" },
    imageModels: { openai: "o-img", google: "g-img" },
  };
  const deps = (client: PoolClient): ResolveDeps => ({ client, decrypt, config });

  beforeAll(async () => {
    try {
      const c = await getPool().connect();
      c.release();
      available = true;
    } catch {
      available = false;
    }
  });
  afterAll(async () => {
    await closePool();
  });
  beforeEach((ctx) => {
    if (!available) ctx.skip();
  });

  /** Creates a user with the given ai_purpose_config, returns the user id. */
  async function makeUser(
    c: PoolClient,
    aiPurposeConfig: Record<string, unknown>,
  ): Promise<string> {
    const uid = randomUUID();
    await c.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2)`,
      [uid, `${uid}@example.com`],
    );
    await c.query(
      `insert into profiles (id, email, ai_purpose_config) values ($1, $2, $3::jsonb)`,
      [uid, `${uid}@example.com`, JSON.stringify(aiPurposeConfig)],
    );
    return uid;
  }

  async function addKey(
    c: PoolClient,
    userId: string,
    provider: string,
    plaintext: string,
    status: string,
  ): Promise<void> {
    await c.query(
      `insert into user_api_keys (user_id, provider, credentials_ciphertext, status)
       values ($1, $2, $3, $4)`,
      [userId, provider, encryptWithKey(plaintext, testKey), status],
    );
  }

  it("standard: resolves the selected provider's valid BYOK key (decrypted)", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, { text: "openai", image: null });
      await addKey(c, uid, "openai", "sk-user-openai", "valid");
      const key = await resolveTextKey({ plan: "standard", userId: uid }, deps(c));
      expect(key).toEqual({
        provider: "openai",
        keySource: "byok",
        apiKey: "sk-user-openai",
        model: "o-model",
      });
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("md resolves identically to standard (BYOK)", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, { text: "anthropic", image: null });
      await addKey(c, uid, "anthropic", "sk-user-anthropic", "valid");
      const key = await resolveTextKey({ plan: "md", userId: uid }, deps(c));
      expect(key.keySource).toBe("byok");
      expect(key.provider).toBe("anthropic");
      expect(key.apiKey).toBe("sk-user-anthropic");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("api_key_required when no provider is selected", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, {});
      await expect(
        resolveTextKey({ plan: "standard", userId: uid }, deps(c)),
      ).rejects.toMatchObject({ code: "api_key_required" });
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("api_key_required when the selected provider has no key row (missing)", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, { text: "openai", image: null });
      let err: unknown;
      await resolveTextKey({ plan: "standard", userId: uid }, deps(c)).catch((e) => (err = e));
      expect(err).toBeInstanceOf(ApiKeyRequiredError);
      expect((err as ApiKeyRequiredError).details.reason).toBe("key_missing");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("api_key_required when the key exists but is invalid", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, { text: "openai", image: null });
      await addKey(c, uid, "openai", "sk-user-openai", "invalid");
      let err: unknown;
      await resolveTextKey({ plan: "standard", userId: uid }, deps(c)).catch((e) => (err = e));
      expect(err).toBeInstanceOf(ApiKeyRequiredError);
      expect((err as ApiKeyRequiredError).details.reason).toBe("key_invalid");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("text: rejects an unsupported provider value in JSONB as api_key_required (not a server error)", async () => {
    await withTransaction(async (c) => {
      // 'x' is a legit api_provider enum value but not a text provider; user-controlled JSONB.
      const uid = await makeUser(c, { text: "x", image: null });
      let err: unknown;
      await resolveTextKey({ plan: "standard", userId: uid }, deps(c)).catch((e) => (err = e));
      expect(err).toBeInstanceOf(ApiKeyRequiredError);
      expect((err as ApiKeyRequiredError).details.reason).toBe("unsupported_provider");
      expect((err as ApiKeyRequiredError).details.provider).toBe("x");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("image: resolves a valid BYOK google key", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, { text: "openai", image: "google" });
      await addKey(c, uid, "google", "sk-user-google", "valid");
      const key = await resolveImageKey({ plan: "standard", userId: uid }, deps(c));
      expect(key).toMatchObject({
        provider: "google",
        keySource: "byok",
        apiKey: "sk-user-google",
        model: "g-img",
      });
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("image: rejects anthropic as an image provider (unsupported)", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, { text: "anthropic", image: "anthropic" });
      let err: unknown;
      await resolveImageKey({ plan: "standard", userId: uid }, deps(c)).catch((e) => (err = e));
      expect(err).toBeInstanceOf(ApiKeyRequiredError);
      expect((err as ApiKeyRequiredError).details.reason).toBe("unsupported_provider");
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });

  it("throws ProviderConfigError when the selected provider's model is unconfigured", async () => {
    await withTransaction(async (c) => {
      const uid = await makeUser(c, { text: "google", image: null });
      await addKey(c, uid, "google", "sk-user-google", "valid");
      const brokenDeps: ResolveDeps = {
        client: c,
        decrypt,
        config: { ...config, textModels: { anthropic: "a", openai: "o" } }, // no google
      };
      await expect(
        resolveTextKey({ plan: "standard", userId: uid }, brokenDeps),
      ).rejects.toBeInstanceOf(ProviderConfigError);
      throw new Error("rollback");
    }).catch((e) => {
      if (!(e instanceof Error) || e.message !== "rollback") throw e;
    });
  });
});

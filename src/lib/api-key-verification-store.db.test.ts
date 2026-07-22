import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import {
  applyApiKeyVerification,
  loadApiKeyVerificationTarget,
} from "./api-key-verification-store";

describe("API key verification persistence", () => {
  let database: Awaited<ReturnType<typeof connectLocalDb>>;

  beforeAll(async () => {
    database = await connectLocalDb();
    if (database) await database.query("begin");
  });

  afterAll(async () => {
    if (database) {
      await database.query("rollback");
      await database.end();
    }
  });

  async function createUser(plan: "standard" | "premium") {
    const userId = randomUUID();
    await database!.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await database!.query("update profiles set plan = $2 where id = $1", [
      userId,
      plan,
    ]);
    return userId;
  }

  it("sets valid/invalid and only fills previously unset AI purposes", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const client = db as unknown as PoolClient;
    const userId = await createUser("standard");
    await db.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext, status)
       values ($1, 'anthropic', 'cipher-anthropic', 'unchecked'),
              ($1, 'openai', 'cipher-openai', 'unchecked'),
              ($1, 'google', 'cipher-google', 'unchecked'),
              ($1, 'x', 'cipher-x', 'unchecked')`,
      [userId],
    );

    await expect(
      loadApiKeyVerificationTarget(client, { provider: "openai", userId }),
    ).resolves.toEqual({ ciphertext: "cipher-openai", provider: "openai" });
    await expect(
      loadApiKeyVerificationTarget(client, { provider: "x", userId }),
    ).resolves.toEqual({ ciphertext: "cipher-x", provider: "x" });

    const verifiedAt = new Date("2026-07-23T00:00:00.000Z");
    await applyApiKeyVerification(client, {
      expectedCiphertext: "cipher-openai",
      now: verifiedAt,
      provider: "openai",
      status: "valid",
      userId,
    });
    let state = await db.query<{
      ai_purpose_config: Record<string, unknown>;
      status: string;
      verified_at: Date | null;
    }>(
      `select p.ai_purpose_config, k.status, k.verified_at
         from profiles p join user_api_keys k on k.user_id = p.id
        where p.id = $1 and k.provider = 'openai'`,
      [userId],
    );
    expect(state.rows[0].ai_purpose_config).toEqual({
      image: "openai",
      text: "openai",
    });
    expect(state.rows[0].status).toBe("valid");
    expect(state.rows[0].verified_at?.toISOString()).toBe(
      verifiedAt.toISOString(),
    );

    await applyApiKeyVerification(client, {
      expectedCiphertext: "cipher-google",
      now: verifiedAt,
      provider: "google",
      status: "valid",
      userId,
    });
    expect(
      (
        await db.query(
          "select ai_purpose_config from profiles where id = $1",
          [userId],
        )
      ).rows[0].ai_purpose_config,
    ).toEqual({ image: "openai", text: "openai" });

    await db.query(
      `update profiles
          set ai_purpose_config = '{"text":null,"image":null}'::jsonb
        where id = $1`,
      [userId],
    );
    await applyApiKeyVerification(client, {
      expectedCiphertext: "cipher-anthropic",
      now: verifiedAt,
      provider: "anthropic",
      status: "valid",
      userId,
    });
    expect(
      (
        await db.query(
          "select ai_purpose_config from profiles where id = $1",
          [userId],
        )
      ).rows[0].ai_purpose_config,
    ).toEqual({ image: null, text: "anthropic" });

    await applyApiKeyVerification(client, {
      expectedCiphertext: "cipher-google",
      now: verifiedAt,
      provider: "google",
      status: "invalid",
      userId,
    });
    state = await db.query(
      `select p.ai_purpose_config, k.status, k.verified_at
         from profiles p join user_api_keys k on k.user_id = p.id
        where p.id = $1 and k.provider = 'google'`,
      [userId],
    );
    expect(state.rows[0]).toMatchObject({
      ai_purpose_config: { image: null, text: "anthropic" },
      status: "invalid",
      verified_at: null,
    });

    await expect(
      applyApiKeyVerification(client, {
        expectedCiphertext: "replaced-ciphertext",
        now: verifiedAt,
        provider: "openai",
        status: "valid",
        userId,
      }),
    ).rejects.toMatchObject({
      code: "job_conflict",
      details: { reason: "api_key_replaced" },
    });
  });

  it("rejects missing keys and premium verification", async (context) => {
    if (!database) return context.skip();
    const client = database as unknown as PoolClient;
    const missingUserId = await createUser("standard");
    await expect(
      loadApiKeyVerificationTarget(client, {
        provider: "anthropic",
        userId: missingUserId,
      }),
    ).rejects.toMatchObject({ code: "api_key_required" });

    const premiumUserId = await createUser("premium");
    await database.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext)
       values ($1, 'openai', 'premium-cipher')`,
      [premiumUserId],
    );
    await expect(
      loadApiKeyVerificationTarget(client, {
        provider: "openai",
        userId: premiumUserId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

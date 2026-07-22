import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import { updateAiPurposeConfigRecord } from "./ai-purpose-config-store";

describe("AI purpose config storage", () => {
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

  async function createUser(plan: "standard" | "md" | "premium") {
    const userId = randomUUID();
    await database!.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await database!.query(
      `update profiles
          set plan = $2,
              ai_purpose_config = '{"text":null,"image":null,"future":true}'::jsonb
        where id = $1`,
      [userId, plan],
    );
    return userId;
  }

  it("allows BYOK purposes only for registered valid keys", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser("md");
    await db.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext, status)
       values ($1, 'anthropic', 'anthropic-key', 'valid'),
              ($1, 'openai', 'openai-key', 'invalid'),
              ($1, 'google', 'google-key', 'valid')`,
      [userId],
    );

    await expect(
      updateAiPurposeConfigRecord(db as unknown as PoolClient, {
        operatorImageProviders: new Set(),
        patch: { image: "google", text: "anthropic" },
        userId,
      }),
    ).resolves.toMatchObject({
      config: { future: true, image: "google", text: "anthropic" },
      plan: "md",
    });
    await expect(
      updateAiPurposeConfigRecord(db as unknown as PoolClient, {
        operatorImageProviders: new Set(),
        patch: { text: "openai" },
        userId,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(
      (
        await db.query(
          "select ai_purpose_config from profiles where id = $1",
          [userId],
        )
      ).rows[0].ai_purpose_config,
    ).toEqual({ future: true, image: "google", text: "anthropic" });
  });

  it("rejects Premium text writes and unavailable operator image providers", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser("premium");

    await expect(
      updateAiPurposeConfigRecord(db as unknown as PoolClient, {
        operatorImageProviders: new Set(["google"]),
        patch: { text: "anthropic" },
        userId,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      updateAiPurposeConfigRecord(db as unknown as PoolClient, {
        operatorImageProviders: new Set(["google"]),
        patch: { image: "openai" },
        userId,
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      updateAiPurposeConfigRecord(db as unknown as PoolClient, {
        operatorImageProviders: new Set(["google"]),
        patch: { image: "google" },
        userId,
      }),
    ).resolves.toMatchObject({
      config: { future: true, image: "google", text: "anthropic" },
      plan: "premium",
    });
    expect(
      (
        await db.query(
          "select ai_purpose_config from profiles where id = $1",
          [userId],
        )
      ).rows[0].ai_purpose_config,
    ).toEqual({ future: true, image: "google", text: null });
  });
});

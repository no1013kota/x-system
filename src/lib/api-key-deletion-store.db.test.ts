import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectLocalDb } from "@/lib/db/test-utils";

import {
  deleteApiKeyRecord,
  loadXApiKeyDeletionTarget,
} from "./api-key-deletion-store";

describe("API key deletion storage", () => {
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

  async function createUser(config: Record<string, unknown>) {
    const userId = randomUUID();
    await database!.query(
      `insert into auth.users (id, instance_id, aud, role, email)
       values ($1, '00000000-0000-0000-0000-000000000000',
               'authenticated', 'authenticated', $2)`,
      [userId, `${userId}@example.com`],
    );
    await database!.query(
      "update profiles set ai_purpose_config = $2::jsonb where id = $1",
      [userId, JSON.stringify(config)],
    );
    return userId;
  }

  it("deletes AI keys and clears only purposes assigned to that provider", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser({
      image: "openai",
      text: "openai",
      unknown_future_field: true,
    });
    await db.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext, status)
       values ($1, 'openai', 'sealed-openai', 'valid'),
              ($1, 'google', 'sealed-google', 'valid')`,
      [userId],
    );

    await deleteApiKeyRecord(db as unknown as PoolClient, {
      provider: "openai",
      userId,
    });

    expect(
      (
        await db.query(
          "select provider from user_api_keys where user_id = $1 order by provider",
          [userId],
        )
      ).rows,
    ).toEqual([{ provider: "google" }]);
    expect(
      (
        await db.query(
          "select ai_purpose_config from profiles where id = $1",
          [userId],
        )
      ).rows[0].ai_purpose_config,
    ).toEqual({ image: null, text: null, unknown_future_field: true });
  });

  it("loads BYOK tokens, deletes the X key, and expires only BYOK accounts", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser({ image: null, text: null });
    await db.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext)
       values ($1, 'x', 'sealed-x-app')`,
      [userId],
    );
    await db.query(
      `insert into x_accounts
        (user_id, x_user_id, handle, name, auth_type, status,
         access_token_ciphertext, refresh_token_ciphertext)
       values
        ($1, $2, 'byok_one', 'BYOK One', 'byok', 'active', 'access-1', 'refresh-1'),
        ($1, $3, 'byok_two', 'BYOK Two', 'byok', 'disabled', 'access-2', null),
        ($1, $4, 'managed', 'Managed', 'managed', 'active', 'managed-access', null)`,
      [userId, `x-${randomUUID()}`, `x-${randomUUID()}`, `x-${randomUUID()}`],
    );

    const target = await loadXApiKeyDeletionTarget(
      db as unknown as PoolClient,
      userId,
    );
    expect(target.credentialsCiphertext).toBe("sealed-x-app");
    expect(target.tokenCiphertexts.sort()).toEqual(
      ["access-1", "access-2", "refresh-1"].sort(),
    );

    await deleteApiKeyRecord(db as unknown as PoolClient, {
      expectedXCiphertext: target.credentialsCiphertext,
      provider: "x",
      userId,
    });

    expect(
      (
        await db.query(
          "select count(*)::int as count from user_api_keys where user_id = $1 and provider = 'x'",
          [userId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await db.query(
          `select auth_type, status, access_token_ciphertext
             from x_accounts where user_id = $1 order by auth_type, handle`,
          [userId],
        )
      ).rows,
    ).toEqual([
      { access_token_ciphertext: "access-1", auth_type: "byok", status: "expired" },
      { access_token_ciphertext: "access-2", auth_type: "byok", status: "expired" },
      { access_token_ciphertext: "managed-access", auth_type: "managed", status: "active" },
    ]);
  });

  it("does not delete a replacement X key after revoke preparation", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser({});
    await db.query(
      `insert into user_api_keys
        (user_id, provider, credentials_ciphertext)
       values ($1, 'x', 'replacement')`,
      [userId],
    );

    await expect(
      deleteApiKeyRecord(db as unknown as PoolClient, {
        expectedXCiphertext: "old-ciphertext",
        provider: "x",
        userId,
      }),
    ).rejects.toMatchObject({ code: "job_conflict" });
    expect(
      (
        await db.query(
          "select credentials_ciphertext from user_api_keys where user_id = $1 and provider = 'x'",
          [userId],
        )
      ).rows[0].credentials_ciphertext,
    ).toBe("replacement");
  });
});

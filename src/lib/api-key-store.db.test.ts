import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decryptWithKey,
  encryptWithKey,
  resolveKey,
} from "@/lib/crypto/envelope";
import { connectLocalDb } from "@/lib/db/test-utils";

import { saveAiApiKeyRecord, saveXApiKeyRecord } from "./api-key-store";
import { parseXAppCredentials } from "./api-keys";

const KEY = resolveKey("0123456789abcdef0123456789abcdef");
const crypto = {
  decrypt: (ciphertext: string) => decryptWithKey(ciphertext, KEY),
  encrypt: (plaintext: string) => encryptWithKey(plaintext, KEY),
};

describe("BYOK API key storage", () => {
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
    await database!.query("update profiles set plan = $2 where id = $1", [
      userId,
      plan,
    ]);
    return userId;
  }

  it("encrypts X credentials and expires BYOK accounts only when client ID changes", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser("standard");
    const xAccountId = randomUUID();
    await db.query(
      `insert into x_accounts
        (id, user_id, x_user_id, handle, name, auth_type,
         access_token_ciphertext, refresh_token_ciphertext, status)
       values ($1, $2, $3, 'key_test', 'Key Test', 'byok',
               'preserved-access', 'preserved-refresh', 'active')`,
      [xAccountId, userId, `x_${xAccountId}`],
    );

    const clientId = "client-id-original-1234";
    const first = await saveXApiKeyRecord(
      db as unknown as PoolClient,
      { client_id: clientId, client_type: "public", userId },
      crypto,
    );
    expect(first).toEqual({
      displayHint: {
        client_id_last4: "1234",
        client_type: "public",
        has_client_secret: false,
      },
      provider: "x",
      status: "unchecked",
    });
    expect(JSON.stringify(first)).not.toContain(clientId);

    const stored = await db.query<{
      credentials_ciphertext: string;
      display_hint: Record<string, unknown>;
      status: string;
      verified_at: string | null;
    }>(
      `select credentials_ciphertext, display_hint, status, verified_at
         from user_api_keys where user_id = $1 and provider = 'x'`,
      [userId],
    );
    expect(stored.rows[0].credentials_ciphertext).not.toContain(clientId);
    expect(parseXAppCredentials(crypto.decrypt(stored.rows[0].credentials_ciphertext))).toEqual({
      clientId,
      clientSecret: null,
      clientType: "public",
    });
    expect(stored.rows[0]).toMatchObject({
      display_hint: {
        client_id_last4: "1234",
        client_type: "public",
        has_client_secret: false,
      },
      status: "unchecked",
      verified_at: null,
    });

    const clientSecret = "confidential-secret-5678";
    await saveXApiKeyRecord(
      db as unknown as PoolClient,
      {
        client_id: clientId,
        client_secret: clientSecret,
        client_type: "confidential",
        userId,
      },
      crypto,
    );
    expect(
      (await db.query("select status from x_accounts where id = $1", [xAccountId]))
        .rows[0].status,
    ).toBe("active");

    const changedClientId = "client-id-replaced-9999";
    const changed = await saveXApiKeyRecord(
      db as unknown as PoolClient,
      { client_id: changedClientId, client_type: "public", userId },
      crypto,
    );
    expect(JSON.stringify(changed)).not.toContain(changedClientId);
    expect(JSON.stringify(changed)).not.toContain(clientSecret);
    const expired = await db.query(
      `select status, access_token_ciphertext, refresh_token_ciphertext
         from x_accounts where id = $1`,
      [xAccountId],
    );
    expect(expired.rows[0]).toEqual({
      access_token_ciphertext: "preserved-access",
      refresh_token_ciphertext: "preserved-refresh",
      status: "expired",
    });
  });

  it("upserts each AI provider with ciphertext and only a last-four hint", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser("md");
    const secrets = {
      anthropic: "anthropic-secret-value-1111",
      google: "google-secret-value-3333",
      openai: "openai-secret-value-2222",
    } as const;
    for (const [provider, apiKey] of Object.entries(secrets)) {
      const result = await saveAiApiKeyRecord(
        db as unknown as PoolClient,
        {
          apiKey,
          provider: provider as keyof typeof secrets,
          userId,
        },
        crypto,
      );
      expect(JSON.stringify(result)).not.toContain(apiKey);
      expect(result.displayHint).toEqual({ api_key_last4: apiKey.slice(-4) });
    }
    const replacement = "anthropic-replacement-value-4444";
    await saveAiApiKeyRecord(
      db as unknown as PoolClient,
      { apiKey: replacement, provider: "anthropic", userId },
      crypto,
    );
    const rows = await db.query<{
      credentials_ciphertext: string;
      display_hint: { api_key_last4: string };
      provider: keyof typeof secrets;
      status: string;
      verified_at: string | null;
    }>(
      `select provider, credentials_ciphertext, display_hint, status, verified_at
         from user_api_keys where user_id = $1 order by provider`,
      [userId],
    );
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      const expected = row.provider === "anthropic" ? replacement : secrets[row.provider];
      expect(row.credentials_ciphertext).not.toContain(expected);
      expect(crypto.decrypt(row.credentials_ciphertext)).toBe(expected);
      expect(row.display_hint).toEqual({ api_key_last4: expected.slice(-4) });
      expect(row.status).toBe("unchecked");
      expect(row.verified_at).toBeNull();
    }
  });

  it("rejects both X and AI key storage for premium", async (context) => {
    if (!database) return context.skip();
    const db = database;
    const userId = await createUser("premium");
    await expect(
      saveXApiKeyRecord(
        db as unknown as PoolClient,
        { client_id: "premium-client-id", client_type: "public", userId },
        crypto,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      saveAiApiKeyRecord(
        db as unknown as PoolClient,
        {
          apiKey: "premium-secret-value-0000",
          provider: "openai",
          userId,
        },
        crypto,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (
        await db.query(
          "select count(*)::int as count from user_api_keys where user_id = $1",
          [userId],
        )
      ).rows[0].count,
    ).toBe(0);
  });
});

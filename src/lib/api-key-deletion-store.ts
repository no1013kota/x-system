import type { PoolClient } from "pg";

import { AppError } from "@/lib/observability/errors";

import type {
  DeletableApiKeyProvider,
  XApiKeyDeletionTarget,
} from "./api-key-deletion";

export async function loadXApiKeyDeletionTarget(
  client: PoolClient,
  userId: string,
): Promise<XApiKeyDeletionTarget> {
  const profile = await client.query(
    "select id from profiles where id = $1",
    [userId],
  );
  if (!profile.rows[0]) throw new AppError("not_found");

  const key = await client.query<{ credentials_ciphertext: string }>(
    `select credentials_ciphertext
       from user_api_keys
      where user_id = $1 and provider = 'x'`,
    [userId],
  );
  const accounts = await client.query<{
    access_token_ciphertext: string | null;
    refresh_token_ciphertext: string | null;
  }>(
    `select access_token_ciphertext, refresh_token_ciphertext
       from x_accounts
      where user_id = $1 and auth_type = 'byok'`,
    [userId],
  );
  return {
    credentialsCiphertext: key.rows[0]?.credentials_ciphertext ?? null,
    tokenCiphertexts: accounts.rows.flatMap((row) =>
      [row.access_token_ciphertext, row.refresh_token_ciphertext].filter(
        (value): value is string => typeof value === "string",
      ),
    ),
  };
}

export async function deleteApiKeyRecord(
  client: PoolClient,
  input: {
    expectedXCiphertext?: string | null;
    provider: DeletableApiKeyProvider;
    userId: string;
  },
): Promise<void> {
  const profile = await client.query<{ ai_purpose_config: unknown }>(
    "select ai_purpose_config from profiles where id = $1 for update",
    [input.userId],
  );
  if (!profile.rows[0]) throw new AppError("not_found");

  const key = await client.query<{ credentials_ciphertext: string }>(
    `select credentials_ciphertext
       from user_api_keys
      where user_id = $1 and provider = $2
      for update`,
    [input.userId, input.provider],
  );
  if (input.provider === "x") {
    const current = key.rows[0]?.credentials_ciphertext ?? null;
    if (current !== input.expectedXCiphertext) {
      throw new AppError("job_conflict", {
        details: { reason: "api_key_replaced" },
      });
    }
  }

  await client.query(
    "delete from user_api_keys where user_id = $1 and provider = $2",
    [input.userId, input.provider],
  );
  if (input.provider === "x") {
    await client.query(
      `update x_accounts
          set status = 'expired'
        where user_id = $1 and auth_type = 'byok'`,
      [input.userId],
    );
    return;
  }

  const raw = profile.rows[0].ai_purpose_config;
  const config =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  if (config.text === input.provider) config.text = null;
  if (config.image === input.provider) config.image = null;
  await client.query(
    "update profiles set ai_purpose_config = $2::jsonb where id = $1",
    [input.userId, JSON.stringify(config)],
  );
}

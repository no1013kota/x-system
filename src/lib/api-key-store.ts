import type { PoolClient } from "pg";

import { AppError } from "@/lib/observability/errors";
import type { PlanId } from "@/lib/plans";

import {
  lastFour,
  parseXAppCredentials,
  serializeXAppCredentials,
  type AiKeyProvider,
  type SaveXApiKeyInput,
} from "./api-keys";

export interface ApiKeyCrypto {
  decrypt(ciphertext: string): string;
  encrypt(plaintext: string): string;
}

export interface MaskedApiKey {
  displayHint: Record<string, boolean | string>;
  provider: "x" | AiKeyProvider;
  status: "unchecked";
}

async function lockByokProfile(
  client: PoolClient,
  userId: string,
): Promise<PlanId> {
  const profile = await client.query<{ plan: PlanId }>(
    "select plan from profiles where id = $1 for update",
    [userId],
  );
  if (!profile.rows[0]) throw new AppError("not_found");
  if (profile.rows[0].plan === "premium") {
    throw new AppError("forbidden");
  }
  return profile.rows[0].plan;
}

export async function saveXApiKeyRecord(
  client: PoolClient,
  input: SaveXApiKeyInput & { userId: string },
  crypto: ApiKeyCrypto,
): Promise<MaskedApiKey> {
  await lockByokProfile(client, input.userId);
  const existing = await client.query<{ credentials_ciphertext: string }>(
    `select credentials_ciphertext
       from user_api_keys
      where user_id = $1 and provider = 'x'`,
    [input.userId],
  );
  let clientIdChanged = false;
  if (existing.rows[0]) {
    try {
      const previous = parseXAppCredentials(
        crypto.decrypt(existing.rows[0].credentials_ciphertext),
      );
      clientIdChanged = previous.clientId !== input.client_id;
    } catch (cause) {
      throw new AppError("internal_error", { cause });
    }
  }

  const displayHint = {
    client_id_last4: lastFour(input.client_id),
    client_type: input.client_type,
    has_client_secret: input.client_type === "confidential",
  };
  const ciphertext = crypto.encrypt(serializeXAppCredentials(input));
  await client.query(
    `insert into user_api_keys
      (user_id, provider, credentials_ciphertext, display_hint, status, verified_at)
     values ($1, 'x', $2, $3::jsonb, 'unchecked', null)
     on conflict (user_id, provider) do update
       set credentials_ciphertext = excluded.credentials_ciphertext,
           display_hint = excluded.display_hint,
           status = 'unchecked',
           verified_at = null`,
    [input.userId, ciphertext, JSON.stringify(displayHint)],
  );
  if (clientIdChanged) {
    await client.query(
      `update x_accounts
          set status = 'expired'
        where user_id = $1 and auth_type = 'byok'`,
      [input.userId],
    );
  }
  return { displayHint, provider: "x", status: "unchecked" };
}

export async function saveAiApiKeyRecord(
  client: PoolClient,
  input: { apiKey: string; provider: AiKeyProvider; userId: string },
  crypto: Pick<ApiKeyCrypto, "encrypt">,
): Promise<MaskedApiKey> {
  await lockByokProfile(client, input.userId);
  const displayHint = { api_key_last4: lastFour(input.apiKey) };
  const ciphertext = crypto.encrypt(input.apiKey);
  await client.query(
    `insert into user_api_keys
      (user_id, provider, credentials_ciphertext, display_hint, status, verified_at)
     values ($1, $2, $3, $4::jsonb, 'unchecked', null)
     on conflict (user_id, provider) do update
       set credentials_ciphertext = excluded.credentials_ciphertext,
           display_hint = excluded.display_hint,
           status = 'unchecked',
           verified_at = null`,
    [input.userId, input.provider, ciphertext, JSON.stringify(displayHint)],
  );
  return { displayHint, provider: input.provider, status: "unchecked" };
}

import type { PoolClient } from "pg";

import { AppError } from "@/lib/observability/errors";
import type { PlanId } from "@/lib/plans";

import type { VerifiableApiKeyProvider } from "./api-key-verification";

export async function loadApiKeyVerificationTarget(
  client: PoolClient,
  input: { provider: VerifiableApiKeyProvider; userId: string },
): Promise<{ ciphertext: string; provider: VerifiableApiKeyProvider }> {
  const result = await client.query<{
    credentials_ciphertext: string;
    plan: PlanId;
  }>(
    `select p.plan, k.credentials_ciphertext
       from profiles p
       left join user_api_keys k
         on k.user_id = p.id and k.provider = $2
      where p.id = $1`,
    [input.userId, input.provider],
  );
  const row = result.rows[0];
  if (!row) throw new AppError("not_found");
  if (row.plan === "premium") throw new AppError("forbidden");
  if (!row.credentials_ciphertext) {
    throw new AppError("api_key_required", {
      details: { provider: input.provider, settingsPath: "/app/settings?tab=api-keys" },
    });
  }
  return { ciphertext: row.credentials_ciphertext, provider: input.provider };
}

export async function applyApiKeyVerification(
  client: PoolClient,
  input: {
    expectedCiphertext: string;
    now: Date;
    provider: Exclude<VerifiableApiKeyProvider, "x">;
    status: "invalid" | "valid";
    userId: string;
  },
): Promise<void> {
  const profile = await client.query<{ ai_purpose_config: unknown }>(
    "select ai_purpose_config from profiles where id = $1 for update",
    [input.userId],
  );
  if (!profile.rows[0]) throw new AppError("not_found");
  const updated = await client.query(
    `update user_api_keys
        set status = $4::api_key_status,
            verified_at = case
              when $4::api_key_status = 'valid'::api_key_status
                then $5::timestamptz
              else null
            end
      where user_id = $1
        and provider = $2
        and credentials_ciphertext = $3`,
    [
      input.userId,
      input.provider,
      input.expectedCiphertext,
      input.status,
      input.now.toISOString(),
    ],
  );
  if (updated.rowCount !== 1) {
    throw new AppError("job_conflict", {
      details: { reason: "api_key_replaced" },
    });
  }
  if (input.status !== "valid") return;

  const raw = profile.rows[0].ai_purpose_config;
  const config =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  if (typeof config.text !== "string") config.text = input.provider;
  if (
    (input.provider === "openai" || input.provider === "google") &&
    typeof config.image !== "string"
  ) {
    config.image = input.provider;
  }
  await client.query(
    "update profiles set ai_purpose_config = $2::jsonb where id = $1",
    [input.userId, JSON.stringify(config)],
  );
}

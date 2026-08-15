import type { PoolClient } from "pg";

import { AppError } from "@/lib/observability/errors";
import type { PlanId } from "@/lib/plans";

import {
  resolvePremiumTextPurpose,
  type AiPurposeConfigPatch,
  type ImageAiProvider,
} from "./ai-purpose-config";

function configRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export async function updateAiPurposeConfigRecord(
  client: PoolClient,
  input: {
    operatorImageProviders: ReadonlySet<ImageAiProvider>;
    patch: AiPurposeConfigPatch;
    userId: string;
  },
): Promise<{ config: Record<string, unknown>; plan: PlanId }> {
  const profile = await client.query<{
    ai_purpose_config: unknown;
    plan: PlanId;
  }>(
    "select plan, ai_purpose_config from profiles where id = $1 for update",
    [input.userId],
  );
  const row = profile.rows[0];
  if (!row) throw new AppError("not_found");
  const next = configRecord(row.ai_purpose_config);

  if (row.plan === "premium") {
    // providerは運営固定。UIはモデル選択のため text:"anthropic" を添えて送る（T-M8-107）。
    // 固定値と一致しない変更だけを拒否する。
    if (input.patch.text !== undefined && input.patch.text !== resolvePremiumTextPurpose()) {
      throw new AppError("validation_error", {
        details: { field: "text", reason: "premium_text_read_only" },
      });
    }
    if (
      input.patch.image &&
      !input.operatorImageProviders.has(input.patch.image)
    ) {
      throw new AppError("validation_error", {
        details: { field: "image", reason: "operator_key_unavailable" },
      });
    }
    next.image = input.patch.image ?? null;
    // モデル選択（T-M8-107）。カタログ検証はschemaが済ませている。providerを外したらモデルも外す。
    next.image_model = next.image ? (input.patch.image_model ?? null) : null;
    if (input.patch.text_model !== undefined) next.text_model = input.patch.text_model;
    await client.query(
      "update profiles set ai_purpose_config = $2::jsonb where id = $1",
      [input.userId, JSON.stringify(next)],
    );
    return {
      config: { ...next, text: resolvePremiumTextPurpose() },
      plan: row.plan,
    };
  }

  const selected = new Set<string>();
  if (input.patch.text) selected.add(input.patch.text);
  if (input.patch.image) selected.add(input.patch.image);
  if (selected.size > 0) {
    const keys = await client.query<{ provider: string }>(
      `select provider::text as provider
         from user_api_keys
        where user_id = $1
          and provider = any($2::api_provider[])
          and status = 'valid'`,
      [input.userId, [...selected]],
    );
    const valid = new Set(keys.rows.map((key) => key.provider));
    const invalid = [...selected].find((provider) => !valid.has(provider));
    if (invalid) {
      throw new AppError("validation_error", {
        details: { provider: invalid, reason: "api_key_not_valid" },
      });
    }
  }

  if (input.patch.text !== undefined) next.text = input.patch.text;
  if (input.patch.image !== undefined) next.image = input.patch.image;
  // モデル選択（T-M8-107）。providerが外れたら対応するモデルも外す（宙に浮いた値を残さない）。
  if (input.patch.text_model !== undefined) next.text_model = input.patch.text_model;
  if (input.patch.image_model !== undefined) next.image_model = input.patch.image_model;
  if (!next.text) next.text_model = null;
  if (!next.image) next.image_model = null;
  await client.query(
    "update profiles set ai_purpose_config = $2::jsonb where id = $1",
    [input.userId, JSON.stringify(next)],
  );
  return { config: next, plan: row.plan };
}

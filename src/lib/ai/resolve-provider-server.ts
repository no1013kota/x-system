import "server-only";

import type { Deadline } from "../jobs/deadline";
import { decrypt } from "../crypto";
import { withTransaction } from "../db/pool";
import { env } from "../env";
import type { PlanId } from "../plans";
import { createAnthropicTextGen } from "./anthropic-client";
import { createGeminiTextGen } from "./gemini-client";
import { createOpenAITextGen } from "./openai-client";
import {
  resolveImageKey,
  resolveNewsKey,
  resolveTextKey,
  type KeySource,
  type ResolveConfig,
  type ResolvedKey,
} from "./resolve-provider";
import type { Provider, TextGen } from "./types";

/**
 * resolveProvider の server-only 配線（プロンプト設計書 §5.1）。env/crypto/pool を束ね、
 * 純粋な解決コア（`resolve-provider.ts`）を呼び、解決した provider/キーから実 TextGen を組む。
 * 運営キー・復号済みユーザーキーはこの server-only 境界内に閉じる（メモ要件）。
 */

function buildConfig(): ResolveConfig {
  return {
    premiumTextProvider: env.PREMIUM_TEXT_PROVIDER,
    newsTextProvider: env.NEWS_TEXT_PROVIDER,
    operatorApiKeys: {
      anthropic: env.ANTHROPIC_API_KEY,
      openai: env.OPENAI_API_KEY,
      google: env.GEMINI_API_KEY,
    },
    textModels: {
      anthropic: env.ANTHROPIC_TEXT_MODEL,
      openai: env.OPENAI_TEXT_MODEL,
      google: env.GEMINI_TEXT_MODEL,
    },
    imageModels: {
      openai: env.OPENAI_IMAGE_MODEL,
      google: env.GEMINI_IMAGE_MODEL,
    },
  };
}

function buildTextGen(key: ResolvedKey, deadline?: Deadline): TextGen {
  switch (key.provider) {
    case "anthropic":
      return createAnthropicTextGen({ apiKey: key.apiKey, model: key.model, deadline });
    case "openai":
      return createOpenAITextGen({ apiKey: key.apiKey, model: key.model });
    case "google":
      return createGeminiTextGen({ apiKey: key.apiKey, model: key.model });
    default:
      throw new Error(`unsupported text provider: ${key.provider}`);
  }
}

export interface ResolvedTextProvider {
  textGen: TextGen;
  provider: Provider;
  model: string;
  keySource: KeySource;
}

/** text系job（GEN/LRN/SUGGEST/MD-MERGE）のprovider解決。 */
export async function resolveTextProvider(
  job: { plan: PlanId; userId: string },
  opts: { deadline?: Deadline } = {},
): Promise<ResolvedTextProvider> {
  const config = buildConfig();
  const key = await withTransaction((client) =>
    resolveTextKey({ plan: job.plan, userId: job.userId }, { client, decrypt, config }),
  );
  return {
    textGen: buildTextGen(key, opts.deadline),
    provider: key.provider,
    model: key.model,
    keySource: key.keySource,
  };
}

/** news（全プラン共通・運営固定）のprovider解決。DB不要。 */
export function resolveNewsProvider(
  opts: { deadline?: Deadline } = {},
): ResolvedTextProvider {
  const key = resolveNewsKey(buildConfig());
  return {
    textGen: buildTextGen(key, opts.deadline),
    provider: key.provider,
    model: key.model,
    keySource: key.keySource,
  };
}

/**
 * image（openai/googleのみ）の解決。画像アダプタ実装は後続（GEN-IMG）のため、
 * ここでは解決済みキー情報（provider/keySource/apiKey/model）を返す。
 */
export async function resolveImageProvider(job: {
  plan: PlanId;
  userId: string;
}): Promise<ResolvedKey> {
  const config = buildConfig();
  return withTransaction((client) =>
    resolveImageKey({ plan: job.plan, userId: job.userId }, { client, decrypt, config }),
  );
}

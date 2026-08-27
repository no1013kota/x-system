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
import {
  DEFAULT_IMAGE_MODELS,
  purposeTextModel,
  type TextModelPurpose,
} from "./model-catalog";
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
    newsTextModel: env.NEWS_TEXT_MODEL,
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
    /*
      画像モデルの既定はコード側に持つ（T-M8-334）。環境変数は上書き用——
      未設定でも既定で動くようにしておかないと、環境変数を入れ忘れた環境で
      「画像だけ設定エラーで作れない」という、画面から理由の分からない状態になる（原則3）。
    */
    imageModels: {
      openai: env.OPENAI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODELS.openai,
      google: env.GEMINI_IMAGE_MODEL ?? DEFAULT_IMAGE_MODELS.google,
    },
  };
}

function buildTextGen(key: ResolvedKey, deadline?: Deadline, maxTokens?: number): TextGen {
  switch (key.provider) {
    case "anthropic":
      // maxTokens は Anthropic だけ必須パラメータのため明示上限を持つ（OpenAI/Gemini はAPI既定＝モデル上限）。
      return createAnthropicTextGen({ apiKey: key.apiKey, model: key.model, deadline, maxTokens });
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

/**
 * text系job（GEN/LRN/SUGGEST/MD-MERGE）のprovider解決。
 *
 * `purpose` を渡すと**モデルだけ**を用途別の固定モデルへ差し替える（T-M8-334）。
 * providerとキーは変えない——providerを変えるとキーの有無で失敗経路が増えるうえ、
 * 利用者が選んだ会社と違うところへ本文が渡ることになる。
 * 未知providerでカタログに無ければ差し替えない（元のモデルのまま動く）。
 */
export async function resolveTextProvider(
  job: { plan: PlanId; userId: string },
  opts: { deadline?: Deadline; maxTokens?: number; purpose?: TextModelPurpose } = {},
): Promise<ResolvedTextProvider> {
  const config = buildConfig();
  const resolved = await withTransaction((client) =>
    resolveTextKey({ plan: job.plan, userId: job.userId }, { client, decrypt, config }),
  );
  const fixed = opts.purpose ? purposeTextModel(opts.purpose, resolved.provider) : null;
  const key: ResolvedKey = fixed ? { ...resolved, model: fixed } : resolved;
  return {
    textGen: buildTextGen(key, opts.deadline, opts.maxTokens),
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

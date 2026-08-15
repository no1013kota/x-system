import type { PoolClient } from "pg";

import { resolvePremiumTextPurpose } from "../ai-purpose-config";
import { isCatalogImageModel, isCatalogTextModel } from "./model-catalog";
import type { PlanId } from "../plans";
import { ProviderConfigError } from "./normalize";
import type { Provider } from "./types";

/**
 * プラン×実行種別 → provider/キー解決の中核（プロンプト設計書 §1/§5.1, PRD §8.2,
 * 要件01 §3.5/§7, 要件02 §4.1, A-5）。DB接続と復号は注入し、この中核はserver-only境界に
 * 依存させない（`.db.test.ts` から検証できるようにする）。実SDK配線・env/crypto束ねは
 * `resolve-provider-server.ts`（server-only）で行う。
 *
 * 解決規則:
 * - text（GEN/LRN/SUGGEST/MD-MERGE）: standard/md=BYOK（ai_purpose_config.textのproviderの
 *   validなユーザーキー）、premium=運営provider固定（既定Anthropic、ユーザー設定に依存しない）。
 * - news: 運営 NEWS_TEXT_PROVIDER 固定。無効・未設定はエラー（別providerへ自動切替しない）。
 * - image: openai/googleのみ。standard/md=BYOK、premium=ユーザー選択(openai/google)を運営キーで
 *   解決（textと異なりimageはユーザー選択を尊重・要件02 §4.1/要件06）。未選択・無効値は利用可能な
 *   運営providerへフォールバック。
 * BYOKキー不足/invalidは api_key_required 相当（ApiKeyRequiredError）。運営キー/モデル未設定は
 * サーバ設定エラー（ProviderConfigError）。
 */

export type KeySource = "byok" | "operator";
export type ImageProvider = "openai" | "google";

const IMAGE_PROVIDERS: readonly ImageProvider[] = ["openai", "google"];

/** text/画像に使える文章provider（api_providerの'x'等は除外）。 */
export function isTextProvider(p: string): p is Provider {
  return p === "anthropic" || p === "openai" || p === "google";
}

/** 画像に使えるprovider（openai/googleのみ。anthropicは非対応）。 */
export function isImageProvider(p: string): p is ImageProvider {
  return p === "openai" || p === "google";
}

/** text本文を生成するjob kind（news以外の文章AI実行）。 */
const TEXT_KINDS = new Set([
  "post_generation",
  "learning_analysis",
  "md_merge",
  "suggestion",
]);
export function isTextKind(kind: string): boolean {
  return TEXT_KINDS.has(kind);
}

/** BYOKキー不足・invalid（要件05 §2 `api_key_required` / 400）。 */
export class ApiKeyRequiredError extends Error {
  readonly code = "api_key_required";
  readonly retryable = false;
  constructor(
    readonly details: {
      purpose: "text" | "image";
      /** 選択された生の値（未サポート値も含めて設定画面へ提示できるよう string を許容）。 */
      provider: string | null;
      reason:
        | "no_provider_selected"
        | "key_missing"
        | "key_invalid"
        | "unsupported_provider";
    },
  ) {
    super(
      `api_key_required: ${details.purpose} provider=${details.provider ?? "-"} reason=${details.reason}`,
    );
    this.name = "ApiKeyRequiredError";
  }
}

export interface ResolveConfig {
  premiumTextProvider: Provider;
  newsTextProvider: Provider;
  /** 運営キー（未設定はundefined）。 */
  operatorApiKeys: Partial<Record<Provider, string>>;
  textModels: Partial<Record<Provider, string>>;
  imageModels: Partial<Record<ImageProvider, string>>;
}

export interface ResolvedKey {
  provider: Provider;
  keySource: KeySource;
  apiKey: string;
  model: string;
}

export interface ResolveDeps {
  client: PoolClient;
  decrypt: (serialized: string) => string;
  config: ResolveConfig;
}

interface AiPurposeConfig {
  /** 生の未検証値（JSONBはユーザー管理。providerの妥当性は解決時に検証する）。 */
  text: string | null;
  image: string | null;
  /** 選択モデル（T-M8-107）。カタログ外・providerと不一致はenv既定へフォールバック。 */
  text_model: string | null;
  image_model: string | null;
}

async function getAiPurposeConfig(
  client: PoolClient,
  userId: string,
): Promise<AiPurposeConfig> {
  const { rows } = await client.query<{ ai_purpose_config: unknown }>(
    `select ai_purpose_config from profiles where id = $1`,
    [userId],
  );
  const raw = rows[0]?.ai_purpose_config;
  const cfg =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    text: typeof cfg.text === "string" ? cfg.text : null,
    image: typeof cfg.image === "string" ? cfg.image : null,
    text_model: typeof cfg.text_model === "string" ? cfg.text_model : null,
    image_model: typeof cfg.image_model === "string" ? cfg.image_model : null,
  };
}

/** ユーザー選択モデル。カタログにある値だけを尊重し、それ以外はenv既定へ（黙って未知IDを実APIへ送らない）。 */
function pickTextModel(provider: Provider, selected: string | null, fallback: string | undefined): string | undefined {
  if (selected && isCatalogTextModel(provider, selected)) return selected;
  return fallback;
}

function pickImageModel(
  provider: ImageProvider,
  selected: string | null,
  fallback: string | undefined,
): string | undefined {
  if (selected && isCatalogImageModel(provider, selected)) return selected;
  return fallback;
}

type UserKeyState =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "valid"; apiKey: string };

/** ユーザーキーの状態を返す。valid のときだけ復号済みキーを含める。 */
async function getUserKeyState(
  deps: ResolveDeps,
  userId: string,
  provider: Provider,
): Promise<UserKeyState> {
  const { rows } = await deps.client.query<{
    credentials_ciphertext: string;
    status: string;
  }>(
    `select credentials_ciphertext, status from user_api_keys
      where user_id = $1 and provider = $2`,
    [userId, provider],
  );
  const row = rows[0];
  if (!row) return { status: "missing" };
  if (row.status !== "valid") return { status: "invalid" };
  return { status: "valid", apiKey: deps.decrypt(row.credentials_ciphertext) };
}

function operatorTextKey(provider: Provider, config: ResolveConfig): ResolvedKey {
  const apiKey = config.operatorApiKeys[provider];
  const model = config.textModels[provider];
  if (!apiKey) {
    throw new ProviderConfigError(`operator ${provider} API key is not configured`);
  }
  if (!model) {
    throw new ProviderConfigError(`operator ${provider} text model is not configured`);
  }
  return { provider, keySource: "operator", apiKey, model };
}

/** text（GEN/LRN/SUGGEST/MD-MERGE）のprovider/キー解決。 */
export async function resolveTextKey(
  input: { plan: PlanId; userId: string },
  deps: ResolveDeps,
): Promise<ResolvedKey> {
  if (input.plan === "premium") {
    // providerは運営固定。モデルはユーザー選択を尊重する（T-M8-107。運営キーの実費が
    // モデルで変わるため、単価はMODEL_RATESが台帳へ反映する）。
    const provider = resolvePremiumTextPurpose(deps.config.premiumTextProvider);
    const base = operatorTextKey(provider, deps.config);
    const cfg = await getAiPurposeConfig(deps.client, input.userId);
    return { ...base, model: pickTextModel(provider, cfg.text_model, base.model) ?? base.model };
  }
  // BYOK（standard/md）
  const cfg = await getAiPurposeConfig(deps.client, input.userId);
  if (!cfg.text) {
    throw new ApiKeyRequiredError({
      purpose: "text",
      provider: null,
      reason: "no_provider_selected",
    });
  }
  // ユーザー管理のJSONB値がサポート外provider（'x'やtypo等）なら user error にする（image側と対称）。
  if (!isTextProvider(cfg.text)) {
    throw new ApiKeyRequiredError({
      purpose: "text",
      provider: cfg.text,
      reason: "unsupported_provider",
    });
  }
  const provider = cfg.text;
  const model = pickTextModel(provider, cfg.text_model, deps.config.textModels[provider]);
  if (!model) {
    throw new ProviderConfigError(`${provider} text model is not configured`);
  }
  const key = await getUserKeyState(deps, input.userId, provider);
  if (key.status !== "valid") {
    throw new ApiKeyRequiredError({
      purpose: "text",
      provider,
      reason: key.status === "invalid" ? "key_invalid" : "key_missing",
    });
  }
  return { provider, keySource: "byok", apiKey: key.apiKey, model };
}

/** news（全プラン共通・運営固定）。無効・未設定は失敗し別providerへ自動切替しない（要件01 §7）。 */
export function resolveNewsKey(config: ResolveConfig): ResolvedKey {
  return operatorTextKey(config.newsTextProvider, config);
}

/**
 * image（openai/googleのみ）。standard/md=BYOK、premium=ユーザー選択(openai/google)を運営キーで解決。
 * premiumのimageはtextと異なりユーザー選択を尊重する（要件02 §4.1・要件06）。
 */
export async function resolveImageKey(
  input: { plan: PlanId; userId: string },
  deps: ResolveDeps,
): Promise<ResolvedKey> {
  if (input.plan === "premium") {
    // premiumのimageは運営キーを使うが、providerはユーザーがopenai/googleから選べる
    //（要件02 §4.1・要件06。textの固定と異なりimageは選択を尊重する）。
    const cfg = await getAiPurposeConfig(deps.client, input.userId);
    if (cfg.image && isImageProvider(cfg.image)) {
      const apiKey = deps.config.operatorApiKeys[cfg.image];
      const model = pickImageModel(cfg.image, cfg.image_model, deps.config.imageModels[cfg.image]);
      if (apiKey && model) {
        return { provider: cfg.image, keySource: "operator", apiKey, model };
      }
      // ユーザーが選んだproviderの運営キー/モデルが未設定 → 別providerへ黙って切替せずサーバ設定エラー。
      throw new ProviderConfigError(
        `operator image provider ${cfg.image} is selected but its key/model is not configured`,
      );
    }
    // 未選択、または保存値が画像provider(openai/google)でない場合は、運営キーが利用可能な
    // provider（openai優先）へフォールバックする（premiumは常に画像生成できるようにする）。
    for (const provider of IMAGE_PROVIDERS) {
      const apiKey = deps.config.operatorApiKeys[provider];
      const model = deps.config.imageModels[provider];
      if (apiKey && model) {
        return { provider, keySource: "operator", apiKey, model };
      }
    }
    throw new ProviderConfigError(
      "no operator image provider (openai/google) is configured",
    );
  }
  // BYOK（standard/md）
  const cfg = await getAiPurposeConfig(deps.client, input.userId);
  if (!cfg.image) {
    throw new ApiKeyRequiredError({
      purpose: "image",
      provider: null,
      reason: "no_provider_selected",
    });
  }
  if (!isImageProvider(cfg.image)) {
    // Claudeは画像生成非対応（PRD §8.2）。
    throw new ApiKeyRequiredError({
      purpose: "image",
      provider: cfg.image,
      reason: "unsupported_provider",
    });
  }
  const provider = cfg.image;
  const model = pickImageModel(provider, cfg.image_model, deps.config.imageModels[provider]);
  if (!model) {
    throw new ProviderConfigError(`${provider} image model is not configured`);
  }
  const key = await getUserKeyState(deps, input.userId, provider);
  if (key.status !== "valid") {
    throw new ApiKeyRequiredError({
      purpose: "image",
      provider,
      reason: key.status === "invalid" ? "key_invalid" : "key_missing",
    });
  }
  return { provider, keySource: "byok", apiKey: key.apiKey, model };
}

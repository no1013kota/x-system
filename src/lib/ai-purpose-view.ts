import type { AiKeyProvider } from "./api-keys";
import type { ImageAiProvider } from "./ai-purpose-config";
import { isOperatorManagedPlan, type PlanId } from "./plans";

const TEXT_PROVIDER_ORDER: readonly AiKeyProvider[] = [
  "anthropic",
  "openai",
  "google",
];
const IMAGE_PROVIDER_ORDER: readonly ImageAiProvider[] = ["openai", "google"];

export interface AiPurposeProviderOptions {
  image: ImageAiProvider[];
  text: AiKeyProvider[];
}

export function buildAiPurposeProviderOptions(input: {
  operatorImageProviders: readonly ImageAiProvider[];
  plan: PlanId | null;
  validUserProviders: readonly AiKeyProvider[];
}): AiPurposeProviderOptions {
  const available = new Set(
    isOperatorManagedPlan(input.plan)
      ? input.operatorImageProviders
      : input.validUserProviders,
  );
  return {
    image: IMAGE_PROVIDER_ORDER.filter((provider) => available.has(provider)),
    text:
      isOperatorManagedPlan(input.plan)
        ? []
        : TEXT_PROVIDER_ORDER.filter((provider) => available.has(provider)),
  };
}

export function configuredPurpose(
  config: unknown,
  purpose: "image" | "text",
  available: readonly string[],
): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>)[purpose];
  return typeof value === "string" && available.includes(value) ? value : null;
}

/**
 * 画像providerの既定（T-M8-401・運営者の指示 2026-09-01「画像生成にもデフォルトを」）。
 * OpenAIが使えればOpenAI（既定モデルは `DEFAULT_IMAGE_MODELS.openai`＝GPT Image 1.5）、
 * 無ければ使える先頭、何も無ければ null。premiumの実行時フォールバック（`resolveImageKey` の
 * openai優先）と同じ順にして、画面の既定表示と実際に使われるものを一致させる。
 */
export function defaultImageProvider(
  available: readonly ImageAiProvider[],
): ImageAiProvider | null {
  return available.includes("openai") ? "openai" : (available[0] ?? null);
}

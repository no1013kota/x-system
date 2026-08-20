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

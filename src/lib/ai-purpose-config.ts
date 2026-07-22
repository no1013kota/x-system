import type { AiKeyProvider } from "./api-keys";
import { z } from "zod";

export type ImageAiProvider = Extract<AiKeyProvider, "google" | "openai">;

export interface AiPurposeConfigValue extends Record<string, unknown> {
  image: ImageAiProvider | null;
  text: AiKeyProvider | null;
}

export const PREMIUM_TEXT_PROVIDER = "anthropic" as const;

export const updateAiPurposeConfigSchema = z
  .object({
    image: z.enum(["openai", "google"]).nullable().optional(),
    text: z.enum(["anthropic", "openai", "google"]).nullable().optional(),
  })
  .refine((value) => value.image !== undefined || value.text !== undefined, {
    message: "変更する用途を指定してください。",
  });

export type AiPurposeConfigPatch = z.infer<
  typeof updateAiPurposeConfigSchema
>;

/** Premiumの文章用途はユーザー設定やDB値に依存せず、運営Claudeへ固定する。 */
export function resolvePremiumTextPurpose(
  configured: AiKeyProvider = PREMIUM_TEXT_PROVIDER,
): AiKeyProvider {
  return configured;
}

function providerValue(
  config: unknown,
  purpose: "image" | "text",
): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>)[purpose];
  return typeof value === "string" ? value : null;
}

/** Premium→BYOK時に登録済みvalidキーだけを残す純粋な再検証関数。 */
export function revalidateByokAiPurposeConfig(
  config: unknown,
  validProviders: ReadonlySet<string>,
): AiPurposeConfigValue {
  const raw =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  const text = providerValue(config, "text");
  const image = providerValue(config, "image");
  return {
    ...raw,
    image:
      image &&
      (image === "openai" || image === "google") &&
      validProviders.has(image)
        ? image
        : null,
    text:
      text &&
      (text === "anthropic" || text === "openai" || text === "google") &&
      validProviders.has(text)
        ? text
        : null,
  };
}

import type { AiKeyProvider } from "./api-keys";
import { z } from "zod";

import { isCatalogImageModel, isCatalogTextModel } from "./ai/model-catalog";

export type ImageAiProvider = Extract<AiKeyProvider, "google" | "openai">;

export interface AiPurposeConfigValue extends Record<string, unknown> {
  image: ImageAiProvider | null;
  text: AiKeyProvider | null;
  /** 選択モデル（T-M8-107）。null/カタログ外はenv既定モデルへフォールバック。 */
  image_model?: string | null;
  text_model?: string | null;
}

export const PREMIUM_TEXT_PROVIDER = "anthropic" as const;

export const updateAiPurposeConfigSchema = z
  .object({
    image: z.enum(["openai", "google"]).nullable().optional(),
    text: z.enum(["anthropic", "openai", "google"]).nullable().optional(),
    // モデルはproviderと同時に送る（UIはprovider変更時にそのproviderの推奨モデルを添える）。
    image_model: z.string().min(1).nullable().optional(),
    text_model: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) =>
      value.image !== undefined ||
      value.text !== undefined ||
      value.image_model !== undefined ||
      value.text_model !== undefined,
    { message: "変更する用途を指定してください。" },
  )
  // モデル指定はカタログ（model-catalog.ts）にあるものだけを受ける（T-M8-107）。
  .refine(
    (value) =>
      value.text_model == null || (value.text != null && isCatalogTextModel(value.text, value.text_model)),
    { message: "選択できない文章モデルです。" },
  )
  .refine(
    (value) =>
      value.image_model == null ||
      (value.image != null && isCatalogImageModel(value.image, value.image_model)),
    { message: "選択できない画像モデルです。" },
  );

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
  purpose: "image" | "text" | "image_model" | "text_model",
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
  const nextImage =
    image && (image === "openai" || image === "google") && validProviders.has(image)
      ? image
      : null;
  const nextText =
    text && (text === "anthropic" || text === "openai" || text === "google") && validProviders.has(text)
      ? text
      : null;
  const imageModel = providerValue(config, "image_model");
  const textModel = providerValue(config, "text_model");
  return {
    ...raw,
    image: nextImage,
    text: nextText,
    // providerが無効になったら、それに紐づくモデル選択も外す（宙に浮いた値を残さない・T-M8-107）。
    image_model: nextImage ? imageModel : null,
    text_model: nextText ? textModel : null,
  };
}

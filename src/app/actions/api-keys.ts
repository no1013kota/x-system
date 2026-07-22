"use server";

import {
  saveAiApiKeyForUser,
  saveXApiKeyForUser,
} from "@/lib/api-key-store-server";
import { saveAiApiKeySchema, saveXApiKeySchema } from "@/lib/api-keys";
import { getCurrentUser } from "@/lib/auth/session";
import { AppError, toUserFacingError } from "@/lib/observability/errors";

interface ApiKeyActionResult {
  code?: string;
  displayHint?: Record<string, boolean | string>;
  message: string;
  provider?: string;
  status: "error" | "success";
}

function errorResult(error: unknown): ApiKeyActionResult {
  return { ...toUserFacingError(error), status: "error" };
}

export async function saveXApiKey(
  input: unknown,
): Promise<ApiKeyActionResult> {
  const parsed = saveXApiKeySchema.safeParse(input);
  if (!parsed.success) return errorResult(new AppError("validation_error"));
  const user = await getCurrentUser();
  if (!user) return errorResult(new AppError("unauthorized"));
  try {
    const saved = await saveXApiKeyForUser({ ...parsed.data, userId: user.id });
    return {
      displayHint: saved.displayHint,
      message: "X APIキーを暗号化して保存しました。",
      provider: saved.provider,
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function saveAiApiKey(
  input: unknown,
): Promise<ApiKeyActionResult> {
  const parsed = saveAiApiKeySchema.safeParse(input);
  if (!parsed.success) return errorResult(new AppError("validation_error"));
  const user = await getCurrentUser();
  if (!user) return errorResult(new AppError("unauthorized"));
  try {
    const saved = await saveAiApiKeyForUser({
      apiKey: parsed.data.api_key,
      provider: parsed.data.provider,
      userId: user.id,
    });
    return {
      displayHint: saved.displayHint,
      message: "AI APIキーを暗号化して保存しました。",
      provider: saved.provider,
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}

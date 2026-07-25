"use server";

import {
  saveAiApiKeyForUser,
  saveXApiKeyForUser,
} from "@/lib/api-key-store-server";
import { deleteApiKeyForUser } from "@/lib/api-key-deletion-server";
import { verifyApiKeyForUser } from "@/lib/api-key-verification-server";
import {
  AI_KEY_PROVIDERS,
  saveAiApiKeySchema,
  saveXApiKeySchema,
} from "@/lib/api-keys";
import { getCurrentUser } from "@/lib/auth/session";
import { errorResult } from "./_helpers";
import { AppError } from "@/lib/observability/errors";
import { z } from "zod";

interface ApiKeyActionResult {
  code?: string;
  deleted?: boolean;
  displayHint?: Record<string, boolean | string>;
  message: string;
  provider?: string;
  keyStatus?: "invalid" | "unchecked" | "valid";
  status: "error" | "success";
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

const verifySchema = z.object({
  provider: z.enum(["x", ...AI_KEY_PROVIDERS]),
});

export async function verifyApiKey(
  input: unknown,
): Promise<ApiKeyActionResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return errorResult(new AppError("validation_error"));
  const user = await getCurrentUser();
  if (!user) return errorResult(new AppError("unauthorized"));
  try {
    const result = await verifyApiKeyForUser({
      provider: parsed.data.provider,
      userId: user.id,
    });
    if (result.status === "invalid") {
      // 検証失敗はprovider応答を伏せて invalid に畳むが（秘密漏洩防止）、利用者には
      // 「時間をおいて再試行」ではなく貼り直しという正しい回復手順を示す（要件06 §3.2）。
      return {
        code: "provider_error",
        keyStatus: "invalid",
        message:
          "このキーでは認証できませんでした。キーの貼り間違い・失効・利用権限・残高をご確認のうえ、正しいキーを貼り直して保存してください（プロバイダ側の一時的な障害の可能性もあります）。",
        provider: result.provider,
        status: "error",
      };
    }
    return {
      keyStatus: result.status,
      message:
        result.provider === "x"
          ? "X APIキーはOAuth連携完了時に確認します。"
          : "APIキーの疎通を確認しました。",
      provider: result.provider,
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function deleteApiKey(
  input: unknown,
): Promise<ApiKeyActionResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return errorResult(new AppError("validation_error"));
  const user = await getCurrentUser();
  if (!user) return errorResult(new AppError("unauthorized"));
  try {
    const result = await deleteApiKeyForUser({
      provider: parsed.data.provider,
      userId: user.id,
    });
    return {
      deleted: result.deleted,
      message: "APIキーを削除しました。",
      provider: result.provider,
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}

"use server";

import { z } from "zod";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { AppError } from "@/lib/observability/errors";
import { PROMPT_TEMPLATE_KINDS } from "@/lib/prompts/gen-prompts";
import {
  NoActiveAccountError,
  listPromptTemplatesForUser,
  resetPromptTemplateForUser,
  updatePromptTemplateForUser,
} from "@/lib/prompts/prompt-templates-server";
import type { PromptTemplateView } from "@/lib/prompts/prompt-templates";

/**
 * プロンプトテンプレート編集の Server Actions（M-2/M-3, 要件05 §8, T-M5-10）。本人のみ。plan制限
 * （standard forbidden）・8,000字・楽観lock・p5 feature_disabled は中核（prompt-templates.ts）で行う。
 * active Xアカウント未選択は not_found（設定導線）へ変換する。
 */

const kindSchema = z.enum(PROMPT_TEMPLATE_KINDS);
const updateSchema = z.object({
  kind: kindSchema,
  content: z.string(),
  expected_updated_at: z.string().nullable(),
});
const resetSchema = z.object({ kind: kindSchema });

function toError(error: unknown): BaseResult {
  if (error instanceof NoActiveAccountError) {
    return errorResult(new AppError("not_found"));
  }
  return errorResult(error);
}

export async function listPromptTemplatesAction(): Promise<
  BaseResult & {
    templates?: PromptTemplateView[];
    plan?: string;
    quotePostEnabled?: boolean;
    xAccountId?: string | null;
  }
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const res = await listPromptTemplatesForUser(auth.userId);
    return {
      message: "",
      plan: res.plan,
      quotePostEnabled: res.quotePostEnabled,
      status: "success",
      templates: res.templates,
      xAccountId: res.xAccountId,
    };
  } catch (error) {
    return toError(error);
  }
}

export async function updatePromptTemplateAction(
  input: unknown,
): Promise<BaseResult & { template?: PromptTemplateView }> {
  const parsed = parseUserInput(updateSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const template = await updatePromptTemplateForUser({
      userId: auth.userId,
      kind: parsed.data.kind,
      content: parsed.data.content,
      expectedUpdatedAt: parsed.data.expected_updated_at,
    });
    return { message: "プロンプトを保存しました。", status: "success", template };
  } catch (error) {
    return toError(error);
  }
}

export async function resetPromptTemplateAction(
  input: unknown,
): Promise<BaseResult & { template?: PromptTemplateView }> {
  const parsed = parseUserInput(resetSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const template = await resetPromptTemplateForUser({
      userId: auth.userId,
      kind: parsed.data.kind,
    });
    return { message: "システム既定に戻しました。", status: "success", template };
  } catch (error) {
    return toError(error);
  }
}

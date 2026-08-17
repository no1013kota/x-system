"use server";

import { z } from "zod";

import { AppError } from "@/lib/observability/errors";
import {
  NoActiveAccountError,
  updatePatternPromptForUser,
} from "@/lib/post/post-patterns-server";
import type { PatternPromptView } from "@/lib/post/post-patterns-store";
import { parseUserInput } from "@/lib/validation/user-input";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";

/**
 * 投稿パターンの Server Actions（T-M8-129 U3/U4・ADR-0008）。本人のみ。
 *
 * plan制限（standard は編集不可）・8,000字・楽観lock・所有者チェックは
 * `post-patterns-store.ts` / `post-patterns-server.ts` が担う。
 * active Xアカウント未選択は `not_found`（設定導線）へ変換する。
 */

const updatePromptSchema = z.object({
  pattern_id: z.string().uuid(),
  content: z.string(),
  expected_updated_at: z.string().nullable(),
});

function toError(error: unknown): BaseResult {
  if (error instanceof NoActiveAccountError) return errorResult(new AppError("not_found"));
  return errorResult(error);
}

export async function updatePatternPromptAction(
  input: unknown,
): Promise<BaseResult & { prompt?: PatternPromptView }> {
  const parsed = parseUserInput(updatePromptSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const prompt = await updatePatternPromptForUser({
      userId: auth.userId,
      patternId: parsed.data.pattern_id,
      content: parsed.data.content,
      expectedUpdatedAt: parsed.data.expected_updated_at,
    });
    return { message: "", prompt, status: "success" };
  } catch (error) {
    return toError(error);
  }
}

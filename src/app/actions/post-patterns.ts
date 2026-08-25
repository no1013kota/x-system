"use server";

import { z } from "zod";

import { AppError } from "@/lib/observability/errors";
import {
  NoActiveAccountError,
  createPatternForUser,
  deletePatternForUser,
  listPatternsForUser,
  restoreDefaultPatternsForUser,
  updatePatternForUser,
  updatePatternPromptForUser,
} from "@/lib/post/post-patterns-server";
import {
  PATTERN_DESCRIPTION_MAX_CHARS,
  PATTERN_NAME_MAX_CHARS,
  PATTERN_PLACEHOLDER_MAX,
  PATTERN_PLACEHOLDER_NAME_MAX_CHARS,
  PATTERN_PROMPT_MAX_CHARS,
  type CreatedPattern,
  type PatternOption,
  type PatternPromptView,
} from "@/lib/post/post-patterns-store";
import { parseUserInput } from "@/lib/validation/user-input";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";

/**
 * 投稿パターンの Server Actions（T-M8-129 U3/U4・ADR-0008）。本人のみ。
 *
 * plan制限（編集権限は canEditMdAndPrompts・未契約は不可）・8,000字・楽観lock・所有者チェックは
 * `post-patterns-store.ts` / `post-patterns-server.ts` が担う。
 * active Xアカウント未選択は `not_found`（設定導線）へ変換する。
 */

const updatePromptSchema = z.object({
  pattern_id: z.string().uuid(),
  content: z.string(),
  expected_updated_at: z.string().nullable(),
});
const patternIdSchema = z.object({ pattern_id: z.string().uuid() });
/**
 * パターンの入力。**画面から来た値をここで型にする**（DBのCHECKと同じ範囲）。
 * 理由付きの検証は `validatePatternInput` が行う（同じ判定を2度書かない）。
 */
const patternSchema = z.object({
  name: z.string().min(1).max(PATTERN_NAME_MAX_CHARS),
  description: z.string().max(PATTERN_DESCRIPTION_MAX_CHARS).nullable(),
  prompt: z.string().max(PATTERN_PROMPT_MAX_CHARS).nullable(),
  /** プロンプト内の `{名前}` に差し込む入力の定義（T-M8-132）。 */
  placeholders: z
    .array(z.object({ name: z.string().min(1).max(PATTERN_PLACEHOLDER_NAME_MAX_CHARS) }))
    .max(PATTERN_PLACEHOLDER_MAX),
});
/** x_account_id は表示中アカウント（別タブ切替後の誤作成防止・T-M8-196）。 */
const createSchema = patternSchema.extend({ x_account_id: z.string().uuid() });
const restoreSchema = z.object({ x_account_id: z.string().uuid() });
const updateSchema = patternSchema.extend({ pattern_id: z.string().uuid() });

type PatternPayload = z.infer<typeof patternSchema>;

function toInput(data: PatternPayload) {
  return {
    name: data.name,
    description: data.description,
    prompt: data.prompt,
    placeholders: data.placeholders,
  };
}

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

export async function listPatternsAction(): Promise<
  BaseResult & {
    patterns?: PatternOption[];
    prompts?: Record<string, PatternPromptView>;
    plan?: string | null;
  }
> {
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const result = await listPatternsForUser(auth.userId);
    return {
      message: "",
      patterns: result.patterns,
      plan: result.plan,
      prompts: result.prompts,
      status: "success",
    };
  } catch (error) {
    return toError(error);
  }
}

export async function createPatternAction(
  input: unknown,
): Promise<BaseResult & { pattern?: CreatedPattern }> {
  const parsed = parseUserInput(createSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const pattern = await createPatternForUser({
      userId: auth.userId,
      expectedXAccountId: parsed.data.x_account_id,
      pattern: toInput(parsed.data),
    });
    return { message: "", pattern, status: "success" };
  } catch (error) {
    return toError(error);
  }
}

export async function updatePatternAction(
  input: unknown,
): Promise<BaseResult & { pattern?: PatternOption }> {
  const parsed = parseUserInput(updateSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const pattern = await updatePatternForUser({
      userId: auth.userId,
      patternId: parsed.data.pattern_id,
      pattern: toInput(parsed.data),
    });
    return { message: "", pattern, status: "success" };
  } catch (error) {
    return toError(error);
  }
}

/** 削除。**停止した予約の件数を返す**ので、画面が「何が起きたか」を言える。 */
export async function deletePatternAction(
  input: unknown,
): Promise<BaseResult & { deletedName?: string; disabledSlots?: number }> {
  const parsed = parseUserInput(patternIdSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const result = await deletePatternForUser({
      userId: auth.userId,
      patternId: parsed.data.pattern_id,
    });
    return { message: "", status: "success", ...result };
  } catch (error) {
    return toError(error);
  }
}

/** 既定パターンを復元する。**入れた件数**を返す（0件なら「すべて揃っています」と言える）。 */
export async function restoreDefaultPatternsAction(
  input: unknown,
): Promise<BaseResult & { restored?: number }> {
  const parsed = parseUserInput(restoreSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const restored = await restoreDefaultPatternsForUser(auth.userId, parsed.data.x_account_id);
    return { message: "", restored, status: "success" };
  } catch (error) {
    return toError(error);
  }
}

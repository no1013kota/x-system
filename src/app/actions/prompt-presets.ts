"use server";

import { z } from "zod";

import type { PromptPresetView } from "@/lib/prompts/prompt-presets";
import {
  createPromptPresetForUser,
  deletePromptPresetForUser,
  listPromptPresetsForUser,
  setPromptPresetInUseForUser,
  updatePromptPresetForUser,
} from "@/lib/prompts/prompt-presets-server";
import { parseUserInput } from "@/lib/validation/user-input";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";

/**
 * プロンプトの本棚（アカウント.md・画像生成プロンプト）の Server Actions（T-M8-332・要件05 §8）。
 *
 * 本人のみ。プラン制限・字数・見出し構造・楽観lock・使用中の写しは中核
 * （`lib/prompts/prompt-presets*.ts`）が行う。ここは受け口の検証だけ。
 *
 * `x_account_id` は**表示中アカウントを画面が送る**（T-M8-196 と同じ理由。区分だけで宛先を
 * 決めると、別タブで切り替えたあとの保存が別アカウントを書き換える）。
 */

const kindSchema = z.enum(["base_md", "image"]);
const accountSchema = z.object({ x_account_id: z.string().uuid() });

const listSchema = accountSchema.extend({ kind: kindSchema });
const createSchema = listSchema.extend({
  name: z.string().min(1).max(30),
  content: z.string().min(1).max(8000),
});
const updateSchema = accountSchema.extend({
  preset_id: z.string().uuid(),
  name: z.string().min(1).max(30),
  content: z.string().min(1).max(8000),
  expected_updated_at: z.string().min(1),
});
const presetSchema = accountSchema.extend({ preset_id: z.string().uuid() });

export async function listPromptPresetsAction(
  input: unknown,
): Promise<BaseResult & { presets?: PromptPresetView[] }> {
  const parsed = parseUserInput(listSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const presets = await listPromptPresetsForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      kind: parsed.data.kind,
    });
    return { message: "", presets, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function createPromptPresetAction(
  input: unknown,
): Promise<BaseResult & { preset?: PromptPresetView }> {
  const parsed = parseUserInput(createSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const preset = await createPromptPresetForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      kind: parsed.data.kind,
      name: parsed.data.name,
      content: parsed.data.content,
    });
    return { message: "追加しました。", preset, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function updatePromptPresetAction(
  input: unknown,
): Promise<BaseResult & { preset?: PromptPresetView }> {
  const parsed = parseUserInput(updateSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const preset = await updatePromptPresetForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      presetId: parsed.data.preset_id,
      name: parsed.data.name,
      content: parsed.data.content,
      expectedUpdatedAt: parsed.data.expected_updated_at,
    });
    return { message: "保存しました。", preset, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function setPromptPresetInUseAction(
  input: unknown,
): Promise<BaseResult & { preset?: PromptPresetView }> {
  const parsed = parseUserInput(presetSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const preset = await setPromptPresetInUseForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      presetId: parsed.data.preset_id,
    });
    return { message: "使用中にしました。", preset, status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

export async function deletePromptPresetAction(
  input: unknown,
): Promise<BaseResult & { deletedName?: string }> {
  const parsed = parseUserInput(presetSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const res = await deletePromptPresetForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      presetId: parsed.data.preset_id,
    });
    return { deletedName: res.deletedName, message: "削除しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

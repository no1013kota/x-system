"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { errorResult, requireUserId, type BaseResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { FREE_SECTION_MAX_CHARS, personaSettingsSchema } from "@/lib/persona-settings";
import { updatePersonaSettingsForUser } from "@/lib/persona-settings-store";

const inputSchema = z.object({
  expected_base_md_version: z.number().int().min(0),
  settings: personaSettingsSchema,
  /*
    アカウント.mdの手書きセクション（T-M8-355）。**画面から来なければ触らない**——
    古い画面や別経路の保存で、書いてある内容を知らないうちに消さないため。
  */
  reference_style: z.string().max(FREE_SECTION_MAX_CHARS).optional(),
  x_account_id: z.string().uuid(),
});

export interface UpdatePersonaSettingsActionResult {
  code?: string;
  details?: Record<string, unknown>;
  message: string;
  status: "error" | "success";
  version?: number;
}

export async function updatePersonaSettings(
  input: unknown,
): Promise<UpdatePersonaSettingsActionResult> {
  const parsed = parseUserInput(inputSchema, input);
  if (!parsed.success) {
    const error = toUserFacingError(new AppError("validation_error"));
    return { ...error, status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const result = await updatePersonaSettingsForUser({
      expectedBaseMdVersion: parsed.data.expected_base_md_version,
      settings: parsed.data.settings,
      ...(parsed.data.reference_style !== undefined
        ? { freeSections: { referenceStyle: parsed.data.reference_style } }
        : {}),
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
    });
    revalidatePath("/app");
    revalidatePath("/app/settings");
    return {
      message: "アカウント設定を保存しました。",
      status: "success",
      version: result.version,
    };
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * 参考ソースからの提案を捨てる（T-M8-360）。
 *
 * **気に入らなかった反映から戻る道を用意する。** 提案は保存するまで残るので、
 * 用意しないと「毎回開くたびに『まだ保存されていません』が出るのに、消す方法が無い」
 * 状態になる——保存済みの設定へ戻すには全欄を手で打ち直すしかない（行き止まり・原則2）。
 */
export async function discardSettingsProposal(input: unknown): Promise<BaseResult> {
  const parsed = parseUserInput(z.object({ x_account_id: z.string().uuid() }), input);
  if (!parsed.success) {
    const error = toUserFacingError(new AppError("validation_error"));
    return { ...error, status: "error" };
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { pooledQueryable } = await import("@/lib/db/pool");
    // 所有者のアカウントだけを対象にする（他人の提案は消せない）。
    await pooledQueryable().query(
      `update x_accounts set settings_proposal = null
        where id = $1 and user_id = $2`,
      [parsed.data.x_account_id, auth.userId],
    );
    revalidatePath("/app/settings");
    return { message: "反映を取り消しました。", status: "success" };
  } catch (error) {
    return errorResult(error);
  }
}

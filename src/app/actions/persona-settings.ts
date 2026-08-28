"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { errorResult, requireUserId } from "./_helpers";
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

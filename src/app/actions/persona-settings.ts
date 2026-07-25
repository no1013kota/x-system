"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { errorResult } from "./_helpers";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { personaSettingsSchema } from "@/lib/persona-settings";
import { updatePersonaSettingsForUser } from "@/lib/persona-settings-store";

const inputSchema = z.object({
  expected_base_md_version: z.number().int().min(0),
  settings: personaSettingsSchema,
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
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const error = toUserFacingError(new AppError("validation_error"));
    return { ...error, status: "error" };
  }
  const user = await getCurrentUser();
  if (!user) {
    const error = toUserFacingError(new AppError("unauthorized"));
    return { ...error, status: "error" };
  }
  try {
    const result = await updatePersonaSettingsForUser({
      expectedBaseMdVersion: parsed.data.expected_base_md_version,
      settings: parsed.data.settings,
      userId: user.id,
      xAccountId: parsed.data.x_account_id,
    });
    revalidatePath("/app");
    revalidatePath("/app/ai-settings");
    return {
      message: "発信設定を保存しました。",
      status: "success",
      version: result.version,
    };
  } catch (error) {
    return errorResult(error);
  }
}

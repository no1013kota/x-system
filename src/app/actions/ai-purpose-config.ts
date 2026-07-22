"use server";

import { updateAiPurposeConfigForUser } from "@/lib/ai-purpose-config-server";
import { updateAiPurposeConfigSchema } from "@/lib/ai-purpose-config";
import { getCurrentUser } from "@/lib/auth/session";
import {
  AppError,
  toUserFacingError,
  type UserFacingError,
} from "@/lib/observability/errors";

type UpdateAiPurposeConfigResult =
  | {
      config: Record<string, unknown>;
      message: string;
      plan: string;
      status: "success";
    }
  | (UserFacingError & { status: "error" });

export async function updateAiPurposeConfig(
  input: unknown,
): Promise<UpdateAiPurposeConfigResult> {
  const parsed = updateAiPurposeConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ...toUserFacingError(new AppError("validation_error")),
      status: "error",
    };
  }
  const user = await getCurrentUser();
  if (!user) {
    return {
      ...toUserFacingError(new AppError("unauthorized")),
      status: "error",
    };
  }
  try {
    const result = await updateAiPurposeConfigForUser({
      patch: parsed.data,
      userId: user.id,
    });
    return {
      config: result.config,
      message: "AI用途設定を更新しました。",
      plan: result.plan,
      status: "success",
    };
  } catch (error) {
    return { ...toUserFacingError(error), status: "error" };
  }
}

"use server";

import { z } from "zod";

import { type BaseResult, errorResult, requireUserId, validationErrorResult } from "./_helpers";
import { parseUserInput } from "@/lib/validation/user-input";
import { rollbackBaseMdForUser } from "@/lib/base-md-server";

/**
 * アカウント.mdのロールバックの Server Action（M-1, 要件05 §8/§9）。本人のみ。
 * プラン制限・6見出し/5,000字検証・楽観lock・learning running 拒否は中核（base-md.ts）で行う。
 *
 * **本文の取得・保存はここには無い**（T-M8-332）。複数持てるようになったので、
 * 読み書きは本棚の Server Action（`prompt-presets.ts`）が担う。
 */

const rollbackSchema = z.object({
  x_account_id: z.string().uuid(),
  version: z.number().int().min(1),
  expected_version: z.number().int().min(0),
});

export async function rollbackBaseMdAction(
  input: unknown,
): Promise<BaseResult & { version?: number }> {
  const parsed = parseUserInput(rollbackSchema, input);
  if (!parsed.success) {
    return validationErrorResult(parsed.error);
  }
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const { version } = await rollbackBaseMdForUser({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      targetVersion: parsed.data.version,
      expectedVersion: parsed.data.expected_version,
    });
    return { message: "指定のバージョンへロールバックしました。", status: "success", version };
  } catch (error) {
    return errorResult(error);
  }
}

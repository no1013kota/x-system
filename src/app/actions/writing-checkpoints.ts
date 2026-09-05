"use server";

import { z } from "zod";

import { saveWritingCheckpoints } from "@/lib/prompts/writing-checkpoints-server";
import { parseUserInput } from "@/lib/validation/user-input";

import {
  type BaseResult,
  errorResult,
  requireUserId,
  validationErrorResult,
} from "./_helpers";

/**
 * 書き方のチェックポイントの保存（T-M8-447・要件05 §8）。本人のアカウントのみ。
 * `x_account_id` は表示中アカウントを画面が送る（T-M8-196 と同じ理由）。
 */
const saveSchema = z.object({
  x_account_id: z.string().uuid(),
  checkpoint_ids: z.array(z.string().min(1).max(20)).max(50),
});

export async function saveWritingCheckpointsAction(
  input: unknown,
): Promise<BaseResult & { checkpoint_ids?: string[] }> {
  const parsed = parseUserInput(saveSchema, input);
  if (!parsed.success) return validationErrorResult(parsed.error);
  const auth = await requireUserId();
  if (!auth.ok) return auth.result;
  try {
    const ids = await saveWritingCheckpoints({
      userId: auth.userId,
      xAccountId: parsed.data.x_account_id,
      checkpointIds: parsed.data.checkpoint_ids,
    });
    return {
      checkpoint_ids: ids,
      message: "チェックポイントを保存しました。次の生成から反映されます。",
      status: "success",
    };
  } catch (error) {
    return errorResult(error);
  }
}

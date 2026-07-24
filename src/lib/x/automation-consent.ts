import { z } from "zod";

import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "./token-refresh";

/**
 * 自動投稿の明示同意とopt-out（要件05 §4.3/§7・要件02 §3.3, S-3/A-3, T-M4-02）。
 * OAuth認可は同意として扱わない（PRD §8.1）。有効な同意は automation_consent_version が現行版と一致し、
 * consented_at 非null かつ disabled_at null のとき。opt-out（disableXAutomation）は即時反映の正本で、
 * 同一transactionで disabled_at 設定・auto slot 無効化・X投稿未開始のqueued auto起点jobのcancel を行う。
 */

export const recordXAutomationConsentSchema = z.object({
  x_account_id: z.string().uuid(),
  consent_version: z.string().min(1),
  confirmed: z.boolean(),
});
export type RecordXAutomationConsentInput = z.infer<typeof recordXAutomationConsentSchema>;

export interface AutomationConsentState {
  consentVersion: string;
  consented: boolean;
  disabled: boolean;
}

/**
 * 現行説明version＋明示checkbox（confirmed）だけを受理して同意を保存し、opt-out（disabled_at）を解除する。
 * 旧version・未checkは validation_error。所有権は user_id 一致で担保（未所有は not_found）。
 */
export async function recordXAutomationConsent(
  db: Queryable,
  userId: string,
  input: RecordXAutomationConsentInput,
): Promise<AutomationConsentState> {
  if (!input.confirmed) {
    throw new AppError("validation_error", { details: { reason: "consent_not_confirmed" } });
  }
  if (input.consent_version !== CURRENT_AUTOMATION_CONSENT_VERSION) {
    throw new AppError("validation_error", { details: { reason: "stale_consent_version" } });
  }
  const { rowCount } = await db.query(
    `update x_accounts
        set automation_consent_version = $3, automation_consented_at = now(),
            automation_disabled_at = null, updated_at = now()
      where id = $1 and user_id = $2`,
    [input.x_account_id, userId, CURRENT_AUTOMATION_CONSENT_VERSION],
  );
  if ((rowCount ?? 0) === 0) throw new AppError("not_found");
  return { consentVersion: CURRENT_AUTOMATION_CONSENT_VERSION, consented: true, disabled: false };
}

export interface DisableAutomationResult {
  disabledSlots: number;
  canceledJobs: number;
}

/**
 * 自動投稿の即時停止（要件05 §7）。opt-out（disabled_at）＋auto slot無効化＋queued auto起点jobのcancel を
 * 同一 tx で行う。disconnectXAccount からも呼べるよう関数として切り出す。所有権は呼び出し側で確認する。
 * X投稿を開始済み（running）のjobはここでは触れない（worker が X 呼び出し直前に同意再確認する・T-M4-03）。
 */
export async function disableAutomationForAccount(
  tx: Queryable,
  xAccountId: string,
): Promise<DisableAutomationResult> {
  await tx.query(
    `update x_accounts
        set automation_disabled_at = coalesce(automation_disabled_at, now()), updated_at = now()
      where id = $1`,
    [xAccountId],
  );
  const slots = await tx.query(
    `update schedule_slots set enabled = false, updated_at = now()
      where x_account_id = $1 and mode = 'auto' and enabled = true`,
    [xAccountId],
  );
  // auto slot 起点の未着手（queued）生成/投稿jobをcancel（要件05 §7）。draft mode・手動は対象外。
  const jobs = await tx.query(
    `update generation_jobs set status = 'canceled', finished_at = now()
      where x_account_id = $1 and status = 'queued' and kind in ('post_generation', 'post_publish')
        and slot_id in (select id from schedule_slots where x_account_id = $1 and mode = 'auto')`,
    [xAccountId],
  );
  return { disabledSlots: slots.rowCount ?? 0, canceledJobs: jobs.rowCount ?? 0 };
}

export interface DisableXAutomationDeps {
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
}

/** opt-out の Action中核。所有権を確認してから disableAutomationForAccount を実行する。 */
export async function disableXAutomation(
  userId: string,
  xAccountId: string,
  deps: DisableXAutomationDeps,
): Promise<DisableAutomationResult> {
  return deps.runInTx(async (tx) => {
    const owned = await tx.query(
      `select 1 from x_accounts where id = $1 and user_id = $2`,
      [xAccountId, userId],
    );
    if ((owned.rowCount ?? 0) === 0) throw new AppError("not_found");
    return disableAutomationForAccount(tx, xAccountId);
  });
}

import { z } from "zod";

import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "./token-refresh";

/**
 * 自動投稿の明示同意とopt-out（要件05 §4.3/§7・要件02 §3.3, S-3/A-3, T-M4-02）。
 * OAuth認可は同意として扱わない（PRD §8.1）。有効な同意は automation_consent_version が現行版と一致し、
 * consented_at 非null かつ disabled_at null のとき。opt-out（disableXAutomation）は即時反映の正本で、
 * 同一transactionで disabled_at 設定・**全スケジュール枠の無効化**・X投稿未開始のqueued jobのcancel を行う。
 *
 * **画面からの停止は「自動投稿」だけでなく「下書き作成」も止める**（運営者の指示 2026-08-23・T-M8-233）。
 * Xアカウントの切断など他の経路は従来どおり自動投稿だけを止める（`scope` で分ける）。
 * 止めたい人は「いま何も動かないでほしい」のであって、下書きだけ作られ続けるのは意図と違う。
 * 停止で無効化した枠には `paused_by_stop_all_at` を刻み、**再開はその枠だけ**を戻す
 * （利用者が個別に止めていた枠まで復活させない）。auto枠を含む再開は現行版の同意を取り直す。
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
 * スケジュールの即時停止（要件05 §7）。opt-out（disabled_at）＋**全スケジュール枠の無効化**＋
 * その枠起点の queued job の cancel を同一 tx で行う。disconnectXAccount からも呼べるよう切り出す。
 * 所有権は呼び出し側で確認する。
 *
 * **下書き作成の枠（mode='draft'）も止める**（T-M8-233）。停止した枠には `paused_by_stop_all_at` を
 * 刻み、`resumeAutomationForAccount` がその枠だけを戻す。**既に無効だった枠には刻まない**ので、
 * 利用者が個別に停止していた枠は再開しても止まったままになる。
 * X投稿を開始済み（running）のjobはここでは触れない（worker が X 呼び出し直前に同意再確認する・T-M4-03）。
 */
export async function disableAutomationForAccount(
  tx: Queryable,
  xAccountId: string,
  /**
   * `"all"`= 画面の「スケジュールをすべて停止」（自動投稿と下書き作成の両方・T-M8-233）。
   * `"auto"`= 自動投稿だけ（Xアカウントの切断など、下書き設定を消したくない経路の既定）。
   */
  scope: "auto" | "all" = "auto",
): Promise<DisableAutomationResult> {
  const modeFilter = scope === "all" ? "" : " and mode = 'auto'";
  await tx.query(
    `update x_accounts
        set automation_disabled_at = coalesce(automation_disabled_at, now()), updated_at = now()
      where id = $1`,
    [xAccountId],
  );
  const slots = await tx.query(
    `update schedule_slots
        set enabled = false, paused_by_stop_all_at = now(), updated_at = now()
      where x_account_id = $1 and enabled = true${modeFilter}`,
    [xAccountId],
  );
  // 停止した枠起点の未着手（queued）生成/投稿jobをcancel（要件05 §7）。手動の実行は対象外。
  const jobs = await tx.query(
    `update generation_jobs set status = 'canceled', finished_at = now()
      where x_account_id = $1 and status = 'queued' and kind in ('post_generation', 'post_publish')
        and slot_id in (select id from schedule_slots where x_account_id = $1${modeFilter})`,
    [xAccountId],
  );
  return { disabledSlots: slots.rowCount ?? 0, canceledJobs: jobs.rowCount ?? 0 };
}

export interface ResumeAutomationResult {
  resumedSlots: number;
  /** 再開した枠に自動投稿（mode='auto'）が含まれるか。含むなら現行版の同意が要る。 */
  includesAuto: boolean;
}

/**
 * 「すべて停止」で止めた枠だけを元に戻す（T-M8-233）。個別に停止していた枠は触らない。
 * 同意の復帰（`automation_disabled_at = null`）は呼び出し側が担う（auto枠を戻すときだけ必要）。
 */
export async function resumeAutomationForAccount(
  tx: Queryable,
  xAccountId: string,
): Promise<ResumeAutomationResult> {
  const { rows } = await tx.query<{ mode: string }>(
    `update schedule_slots
        set enabled = true, paused_by_stop_all_at = null, updated_at = now()
      where x_account_id = $1 and paused_by_stop_all_at is not null
      returning mode`,
    [xAccountId],
  );
  return { resumedSlots: rows.length, includesAuto: rows.some((r) => r.mode === "auto") };
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
    // 画面の「すべて停止」は下書き作成の枠も止める（T-M8-233）。
    return disableAutomationForAccount(tx, xAccountId, "all");
  });
}

export const resumeXAutomationSchema = z.object({
  x_account_id: z.string().uuid(),
  /** 自動投稿の枠を戻すときだけ必要（説明への同意チェック）。 */
  confirmed: z.boolean().optional(),
  consent_version: z.string().min(1).optional(),
});
export type ResumeXAutomationInput = z.infer<typeof resumeXAutomationSchema>;

export interface ResumeXAutomationOutcome extends ResumeAutomationResult {
  /** 自動投稿の同意を取り直したか（下書き枠だけの再開では false）。 */
  consentRecorded: boolean;
}

/**
 * 「すべて再開」の Action中核（T-M8-233）。所有権を確認し、停止操作で止めた枠を戻す。
 *
 * **自動投稿の枠が含まれるときは現行版の同意を取り直す**（停止＝同意の撤回なので、
 * 黙って自動投稿を再開しない。PRD §8.1）。同意が無い状態で auto 枠を戻そうとした場合は
 * `automation_consent_required` を返し、画面が同意を求める。下書き作成だけの再開は同意不要。
 */
export async function resumeXAutomation(
  userId: string,
  input: ResumeXAutomationInput,
  deps: DisableXAutomationDeps,
): Promise<ResumeXAutomationOutcome> {
  return deps.runInTx(async (tx) => {
    const owned = await tx.query(
      `select 1 from x_accounts where id = $1 and user_id = $2`,
      [input.x_account_id, userId],
    );
    if ((owned.rowCount ?? 0) === 0) throw new AppError("not_found");

    // 戻す対象に auto 枠があるかを**更新前に**見る（同意の要否を先に決める）。
    const pending = await tx.query<{ has_auto: boolean; total: string }>(
      `select coalesce(bool_or(mode = 'auto'), false) as has_auto, count(*)::text as total
         from schedule_slots
        where x_account_id = $1 and paused_by_stop_all_at is not null`,
      [input.x_account_id],
    );
    const needsConsent = pending.rows[0]?.has_auto === true;
    let consentRecorded = false;
    if (needsConsent) {
      const alreadyConsented = await tx.query(
        `select 1 from x_accounts
          where id = $1 and automation_consent_version = $2
            and automation_consented_at is not null and automation_disabled_at is null`,
        [input.x_account_id, CURRENT_AUTOMATION_CONSENT_VERSION],
      );
      if ((alreadyConsented.rowCount ?? 0) === 0) {
        if (input.confirmed !== true || input.consent_version !== CURRENT_AUTOMATION_CONSENT_VERSION) {
          throw new AppError("automation_consent_required");
        }
        await tx.query(
          `update x_accounts
              set automation_consent_version = $2, automation_consented_at = now(),
                  automation_disabled_at = null, updated_at = now()
            where id = $1`,
          [input.x_account_id, CURRENT_AUTOMATION_CONSENT_VERSION],
        );
        consentRecorded = true;
      }
    }
    const result = await resumeAutomationForAccount(tx, input.x_account_id);
    return { ...result, consentRecorded };
  });
}

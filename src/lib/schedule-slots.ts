import { z } from "zod";

import { CURRENT_AUTOMATION_CONSENT_VERSION } from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";

import type { Queryable } from "./x/token-refresh";
import { THEME_IDS } from "@/lib/themes";

/**
 * schedule_slots CRUD の中核（要件05 §7・要件02 §3.10, S-1/S-2/S-4, T-M4-01）。本人のみ・active_x_account
 * スコープ。zod検証（P-5不可・weekdays・時刻・画像provider・instructions）、楽観lock（expected_updated_at
 * 不一致は0件更新→job_conflict）、mode=auto の作成/auto化/再有効化は現行versionの自動投稿同意を必須にする。
 * DB は注入し、Action層（server）が pool と active_x_account 解決を束ねる。
 */

/** 09:00〜22:00 の 00/30 分ちょうど（要件02 §3.10 の CHECK と一致）。 */
const TIME_JST_RE = /^([01]\d|2[0-2]):(00|30)$/;
function validTimeJst(v: string): boolean {
  if (!TIME_JST_RE.test(v)) return false;
  const [h, m] = v.split(":").map(Number);
  if (h < 9 || h > 22) return false;
  if (h === 22 && m !== 0) return false; // 22:30 は上限超過
  return true;
}

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .refine((ws) => new Set(ws).size === ws.length, "曜日が重複しています");

const baseSlotFields = {
  // P-5（引用ポスト）はスケジュール対象外（要件04 §12・要件02 §3.10 CHECK）。
  pattern: z.enum(["p1", "p2", "p3", "p4", "p6"]),
  weekdays: weekdaysSchema,
  time_jst: z.string().refine(validTimeJst, "9:00〜22:00の00分/30分で指定してください"),
  mode: z.enum(["draft", "auto"]),
  /**
   * 分野（発信テーマ）。未指定なら従来どおりベースmdの発信テーマからAIが選ぶ（T-M8-28）。
   * `<select>` の「指定なし」は空文字になるので、**呼び出し側が null へ寄せて渡す**
   * （ここで transform すると出力型が必須になり、既存の呼び出しがすべて壊れる）。
   */
  theme: z.enum(THEME_IDS).nullish(),
  instructions: z.string().max(2000).nullish(),
  image_enabled: z.boolean().optional().default(false),
};

export const createScheduleSlotSchema = z.object(baseSlotFields);
export type CreateScheduleSlotInput = z.infer<typeof createScheduleSlotSchema>;

export const updateScheduleSlotSchema = z
  .object({ slot_id: z.string().uuid(), expected_updated_at: z.string().min(1), ...baseSlotFields });
export type UpdateScheduleSlotInput = z.infer<typeof updateScheduleSlotSchema>;

export const slotLockSchema = z.object({
  slot_id: z.string().uuid(),
  expected_updated_at: z.string().min(1),
});
export type SlotLockInput = z.infer<typeof slotLockSchema>;

export interface ScheduleSlotView {
  id: string;
  pattern: string;
  weekdays: number[];
  time_jst: string;
  mode: string;
  theme: string | null;
  instructions: string | null;
  image_enabled: boolean;
  enabled: boolean;
  updated_at: string;
}

const SLOT_COLUMNS = `id, pattern, weekdays, time_jst::text as time_jst, mode, theme, instructions,
  image_enabled, enabled, updated_at::text as updated_at`;

export interface ScheduleSlotDeps {
  runInTx: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  /** 現在の active_x_account を解決（所有権・status=active・active一致を検証済み）。未解決は null。 */
  resolveActiveXAccountId: (userId: string) => Promise<string | null>;
}

async function requireActiveAccount(deps: ScheduleSlotDeps, userId: string): Promise<string> {
  const id = await deps.resolveActiveXAccountId(userId);
  if (!id) throw new AppError("x_account_required");
  return id;
}

/** mode=auto を有効化する操作の同意ゲート（要件02 §3.3/§3.10, 要件05 §7）。 */
async function assertAutomationConsent(
  tx: Queryable,
  xAccountId: string,
): Promise<void> {
  const row = (
    await tx.query<{
      automation_consent_version: string | null;
      consented: boolean;
      disabled: boolean;
    }>(
      `select automation_consent_version,
              (automation_consented_at is not null) as consented,
              (automation_disabled_at is not null) as disabled
         from x_accounts where id = $1`,
      [xAccountId],
    )
  ).rows[0];
  const ok =
    row != null &&
    row.automation_consent_version === CURRENT_AUTOMATION_CONSENT_VERSION &&
    row.consented &&
    !row.disabled;
  if (!ok) throw new AppError("automation_consent_required");
}

export async function listScheduleSlots(
  db: Queryable,
  xAccountId: string,
): Promise<ScheduleSlotView[]> {
  const { rows } = await db.query<ScheduleSlotView>(
    `select ${SLOT_COLUMNS} from schedule_slots
      where x_account_id = $1 order by time_jst, created_at`,
    [xAccountId],
  );
  return rows;
}

export async function createScheduleSlot(
  userId: string,
  input: CreateScheduleSlotInput,
  deps: ScheduleSlotDeps,
): Promise<ScheduleSlotView> {
  const xAccountId = await requireActiveAccount(deps, userId);
  return deps.runInTx(async (tx) => {
    if (input.mode === "auto") await assertAutomationConsent(tx, xAccountId);
    const { rows } = await tx.query<ScheduleSlotView>(
      `insert into schedule_slots
         (x_account_id, pattern, weekdays, time_jst, mode, theme, instructions, image_enabled)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning ${SLOT_COLUMNS}`,
      [
        xAccountId,
        input.pattern,
        input.weekdays,
        input.time_jst,
        input.mode,
        input.theme ?? null,
        input.instructions ?? null,
        input.image_enabled,
      ],
    );
    return rows[0];
  });
}

async function loadOwnedSlot(
  tx: Queryable,
  userId: string,
  slotId: string,
): Promise<{ mode: string; x_account_id: string } | null> {
  const { rows } = await tx.query<{ mode: string; x_account_id: string }>(
    `select ss.mode, ss.x_account_id
       from schedule_slots ss join x_accounts xa on xa.id = ss.x_account_id
      where ss.id = $1 and xa.user_id = $2`,
    [slotId, userId],
  );
  return rows[0] ?? null;
}

export async function updateScheduleSlot(
  userId: string,
  input: UpdateScheduleSlotInput,
  deps: ScheduleSlotDeps,
): Promise<ScheduleSlotView> {
  return deps.runInTx(async (tx) => {
    const slot = await loadOwnedSlot(tx, userId, input.slot_id);
    if (!slot) throw new AppError("not_found");
    // 現在draftでも今回autoにする場合は同意必須（auto化・再有効化ゲート, 要件05 §7）。
    if (input.mode === "auto") await assertAutomationConsent(tx, slot.x_account_id);
    const { rows } = await tx.query<ScheduleSlotView>(
      `update schedule_slots
          set pattern = $3, weekdays = $4, time_jst = $5, mode = $6, theme = $7,
              instructions = $8, image_enabled = $9, updated_at = now()
        where id = $1 and updated_at::text = $2
      returning ${SLOT_COLUMNS}`,
      [
        input.slot_id,
        input.expected_updated_at,
        input.pattern,
        input.weekdays,
        input.time_jst,
        input.mode,
        input.theme ?? null,
        input.instructions ?? null,
        input.image_enabled,
      ],
    );
    if (rows.length === 0) throw new AppError("job_conflict", { details: { reason: "stale_slot" } });
    return rows[0];
  });
}

export async function disableScheduleSlot(
  userId: string,
  input: SlotLockInput,
  deps: ScheduleSlotDeps,
): Promise<ScheduleSlotView> {
  return deps.runInTx(async (tx) => {
    const slot = await loadOwnedSlot(tx, userId, input.slot_id);
    if (!slot) throw new AppError("not_found");
    const { rows } = await tx.query<ScheduleSlotView>(
      `update schedule_slots set enabled = false, updated_at = now()
        where id = $1 and updated_at::text = $2
      returning ${SLOT_COLUMNS}`,
      [input.slot_id, input.expected_updated_at],
    );
    if (rows.length === 0) throw new AppError("job_conflict", { details: { reason: "stale_slot" } });
    return rows[0];
  });
}

/**
 * 停止したスロットを再開する（要件05 §7・要件06 §1 SC-08）。停止したまま削除しか残らない
 * 行き止まりを避けるため。mode=auto の再開は新規作成と同じく自動投稿の同意を必須にする。
 */
export async function enableScheduleSlot(
  userId: string,
  input: SlotLockInput,
  deps: ScheduleSlotDeps,
): Promise<ScheduleSlotView> {
  return deps.runInTx(async (tx) => {
    const slot = await loadOwnedSlot(tx, userId, input.slot_id);
    if (!slot) throw new AppError("not_found");
    if (slot.mode === "auto") await assertAutomationConsent(tx, slot.x_account_id);
    const { rows } = await tx.query<ScheduleSlotView>(
      `update schedule_slots set enabled = true, updated_at = now()
        where id = $1 and updated_at::text = $2
      returning ${SLOT_COLUMNS}`,
      [input.slot_id, input.expected_updated_at],
    );
    if (rows.length === 0) throw new AppError("job_conflict", { details: { reason: "stale_slot" } });
    return rows[0];
  });
}

export async function deleteScheduleSlot(
  userId: string,
  input: SlotLockInput,
  deps: ScheduleSlotDeps,
): Promise<{ deleted: boolean }> {
  return deps.runInTx(async (tx) => {
    const slot = await loadOwnedSlot(tx, userId, input.slot_id);
    if (!slot) throw new AppError("not_found");
    const { rowCount } = await tx.query(
      `delete from schedule_slots where id = $1 and updated_at::text = $2`,
      [input.slot_id, input.expected_updated_at],
    );
    if ((rowCount ?? 0) === 0) {
      throw new AppError("job_conflict", { details: { reason: "stale_slot" } });
    }
    return { deleted: true };
  });
}

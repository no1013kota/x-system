import type { PoolClient } from "pg";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";

import { AppError } from "@/lib/observability/errors";

import { syncInUsePreset } from "@/lib/prompts/prompt-preset-sync";

import { validateBaseMdStructure } from "./persona-settings";

/**
 * アカウント.mdの手動編集（M-1, 要件05 §8, 要件02 §3.3, プロンプト §3.1）。
 * 見出し構造＋5,000字を検証し、expected version 一致時のみ `x_accounts.base_md`/`base_md_version`
 * を更新する。`learning_analysis`/`md_merge` が running の間は job_conflict で拒否する（要件04 §12）。
 *
 * **変更履歴とロールバックは廃止した**（T-M8-362・運営者の指示 2026-08-29）。
 * `base_md_version` は**楽観ロックの番号として残す**——「誰かが後ろで書き換えた」を
 * 検出する仕組みで、履歴とは別物。戻したいときはプロンプト画面の本棚で別の本文を選ぶ。
 */

export const BASE_MD_MAX_CHARS = 5000;

/** 5見出し構造（## 1.〜## 5. 各1回・順序）＋5,000字上限を検証（違反は validation_error）。 */
export function validateManualBaseMd(content: string): void {
  if (content.length > BASE_MD_MAX_CHARS) {
    throw new AppError("validation_error", {
      details: { reason: "too_long", max: BASE_MD_MAX_CHARS, length: content.length },
    });
  }
  try {
    validateBaseMdStructure(content);
  // eslint-disable-next-line no-restricted-syntax -- 構造検証の失敗が判定結果。AppError(validation_error) で伝わる
  } catch {
    throw new AppError("validation_error", { details: { reason: "structure" } });
  }
}

interface BaseMdAccountRow {
  id: string;
  status: string;
  base_md: string;
  base_md_version: number;
  active_x_account_id: string | null;
  plan: string;
}

async function loadForWrite(
  client: PoolClient,
  userId: string,
  xAccountId: string,
): Promise<BaseMdAccountRow> {
  const row = (
    await client.query<BaseMdAccountRow>(
      `select x.id, x.status, x.base_md, x.base_md_version, p.active_x_account_id, p.plan
         from x_accounts x join profiles p on p.id = x.user_id
        where x.id = $1 and x.user_id = $2
        for update of x, p`,
      [xAccountId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  if (row.status !== "active" || row.active_x_account_id !== row.id) {
    throw new AppError("job_conflict", { details: { reason: "active_x_account_changed" } });
  }
  return row;
}

function assertEditablePlan(plan: string): void {
  // 手動md編集は md/premium のみ（standard は forbidden・要件05 §8）。
  // 判定は `promptEditablePlan` に集約（T-M8-144）。plan名の直比較を各所に置かない。
  if (!promptEditablePlan(plan)) {
    throw new AppError("forbidden", { details: { reason: "plan_not_allowed" } });
  }
}

async function assertNoLearningRunning(client: PoolClient, xAccountId: string): Promise<void> {
  const j = await client.query(
    `select 1 from generation_jobs
      where x_account_id = $1 and kind in ('learning_analysis', 'md_merge') and status = 'running'
      limit 1`,
    [xAccountId],
  );
  if (j.rowCount) {
    throw new AppError("job_conflict", { details: { reason: "base_md_learning_in_progress" } });
  }
}

export interface BaseMdWriteResult {
  version: number;
}

/** M-1 手動編集: 構造/字数検証・楽観lock・学習running拒否のうえ新versionを change_source=manual で確定。 */
export async function applyUpdateBaseMdManual(
  client: PoolClient,
  input: { userId: string; xAccountId: string; content: string; expectedVersion: number },
): Promise<BaseMdWriteResult> {
  const acct = await loadForWrite(client, input.userId, input.xAccountId);
  assertEditablePlan(acct.plan);
  if (acct.base_md_version === 0) {
    // 初版未生成はアカウント設定の初回保存が前提（要件05 §8・SC-10誘導）。
    throw new AppError("persona_required");
  }
  validateManualBaseMd(input.content);
  if (acct.base_md_version !== input.expectedVersion) {
    throw new AppError("job_conflict", {
      details: { reason: "base_md_version_changed", currentBaseMdVersion: acct.base_md_version },
    });
  }
  await assertNoLearningRunning(client, input.xAccountId);

  const version = acct.base_md_version + 1;
  const upd = await client.query(
    `update x_accounts set base_md = $3, base_md_version = $4
      where id = $1 and user_id = $2 and status = 'active' and base_md_version = $5`,
    [input.xAccountId, input.userId, input.content, version, input.expectedVersion],
  );
  if (upd.rowCount !== 1) {
    throw new AppError("job_conflict", { details: { reason: "base_md_version_changed" } });
  }
  // 本棚の「使用中」へも同じ内容を残す（T-M8-332）。**本棚と実物が食い違わないようにする**。
  await syncInUsePreset(client, {
    xAccountId: input.xAccountId,
    kind: "base_md",
    content: input.content,
  });
  return { version };
}

export interface BaseMdView {
  content: string;
  version: number;
}

/** 所有者のみ。現行 base_md と version を返す（未生成は version 0・content ''）。 */
export async function getBaseMd(
  db: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> },
  userId: string,
  xAccountId: string,
): Promise<BaseMdView> {
  const row = (
    await db.query<{ base_md: string; base_md_version: number }>(
      `select x.base_md, x.base_md_version from x_accounts x
        where x.id = $1 and x.user_id = $2`,
      [xAccountId, userId],
    )
  ).rows[0];
  if (!row) throw new AppError("not_found");
  return { content: row.base_md, version: row.base_md_version };
}

/** 所有者のアカウントで learning_analysis/md_merge がrunningか（編集不可表示用の読み取り）。 */
export async function isLearningRunning(
  db: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> },
  userId: string,
  xAccountId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `select 1 from generation_jobs j
       join x_accounts x on x.id = j.x_account_id
      where j.x_account_id = $1 and x.user_id = $2
        and j.kind in ('learning_analysis', 'md_merge') and j.status = 'running'
      limit 1`,
    [xAccountId, userId],
  );
  return (rowCount ?? 0) > 0;
}

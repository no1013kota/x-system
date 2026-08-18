import type { PoolClient } from "pg";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";

import { AppError } from "@/lib/observability/errors";

import { validateBaseMdStructure } from "./persona-settings";

/**
 * アカウント.mdの手動編集・履歴・ロールバック（M-1, 要件05 §8/§9/§12, 要件02 §3.4, プロンプト §3.1, T-M5-08）。
 * md/premium のみ編集可（standard は forbidden）。6見出し構造＋5,000字を検証し、expected version 一致時のみ
 * `x_accounts.base_md`/`base_md_version` と `base_md_versions`（change_source=manual/rollback）を同一tx更新する。
 * learning_analysis/md_merge が running の間は編集/ロールバックを job_conflict で拒否する（要件04 §12）。
 * DB(pool)は呼び出し側が withTransaction で束ねる（persona-settings-store と同じ版管理パターン）。
 */

export const BASE_MD_MAX_CHARS = 5000;

/** 6見出し構造（## 1.〜## 6. 各1回・順序）＋5,000字上限を検証（違反は validation_error）。 */
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
  await client.query(
    `insert into base_md_versions (x_account_id, version, content, change_source, summary)
     values ($1, $2, $3, 'manual', '手動編集')`,
    [input.xAccountId, version, input.content],
  );
  return { version };
}

/** M-1 ロールバック: 指定版の内容を新versionとして作成（履歴は書き換えない・change_source=rollback）。 */
export async function applyRollbackBaseMd(
  client: PoolClient,
  input: { userId: string; xAccountId: string; targetVersion: number; expectedVersion: number },
): Promise<BaseMdWriteResult> {
  const acct = await loadForWrite(client, input.userId, input.xAccountId);
  assertEditablePlan(acct.plan);
  if (acct.base_md_version === 0) throw new AppError("persona_required");
  if (acct.base_md_version !== input.expectedVersion) {
    throw new AppError("job_conflict", {
      details: { reason: "base_md_version_changed", currentBaseMdVersion: acct.base_md_version },
    });
  }
  await assertNoLearningRunning(client, input.xAccountId);

  const target = (
    await client.query<{ content: string }>(
      `select content from base_md_versions where x_account_id = $1 and version = $2`,
      [input.xAccountId, input.targetVersion],
    )
  ).rows[0];
  if (!target) throw new AppError("not_found", { details: { reason: "version_not_found" } });

  const version = acct.base_md_version + 1;
  const upd = await client.query(
    `update x_accounts set base_md = $3, base_md_version = $4
      where id = $1 and user_id = $2 and status = 'active' and base_md_version = $5`,
    [input.xAccountId, input.userId, target.content, version, input.expectedVersion],
  );
  if (upd.rowCount !== 1) {
    throw new AppError("job_conflict", { details: { reason: "base_md_version_changed" } });
  }
  await client.query(
    `insert into base_md_versions (x_account_id, version, content, change_source, summary)
     values ($1, $2, $3, 'rollback', $4)`,
    [input.xAccountId, version, target.content, `v${input.targetVersion}へロールバック`],
  );
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

/** 所有者のアカウントで learning_analysis/md_merge がrunningか（SC-10 編集不可表示用の読み取り）。 */
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

export interface BaseMdVersionView {
  version: number;
  changeSource: string;
  summary: string | null;
  createdAt: string;
}

/** 版履歴（新しい順・所有者のみ）。SC-10 ロールバックUI用。 */
export async function listBaseMdVersions(
  db: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> },
  userId: string,
  xAccountId: string,
): Promise<BaseMdVersionView[]> {
  const { rows } = await db.query<{
    version: number;
    change_source: string;
    summary: string | null;
    created_at: Date | string;
  }>(
    `select v.version, v.change_source, v.summary, v.created_at
       from base_md_versions v
       join x_accounts x on x.id = v.x_account_id
      where v.x_account_id = $1 and x.user_id = $2
      order by v.version desc`,
    [xAccountId, userId],
  );
  return rows.map((r) => ({
    version: r.version,
    changeSource: r.change_source,
    summary: r.summary,
    createdAt: typeof r.created_at === "string" ? new Date(r.created_at).toISOString() : r.created_at.toISOString(),
  }));
}

import type { PoolClient } from "pg";

import { withTransaction } from "@/lib/db/pool";
import { AppError } from "@/lib/observability/errors";

import {
  generateInitialBaseMd,
  personaSettingsSchema,
  rebuildSettingsSections,
  type PersonaSettings,
} from "./persona-settings";

interface PersonaSettingsAccountRow {
  active_x_account_id: string | null;
  base_md: string;
  base_md_version: number;
  id: string;
  status: string;
}

export interface UpdatePersonaSettingsInput {
  expectedBaseMdVersion: number;
  settings: PersonaSettings;
  userId: string;
  xAccountId: string;
}

export interface UpdatePersonaSettingsResult {
  baseMd: string;
  version: number;
}

/** Transaction body exported for DB-backed integration tests. */
export async function applyPersonaSettingsUpdate(
  client: PoolClient,
  input: UpdatePersonaSettingsInput,
): Promise<UpdatePersonaSettingsResult> {
  const settings = personaSettingsSchema.parse(input.settings);
  const accountResult = await client.query<PersonaSettingsAccountRow>(
    `select x.id, x.status, x.base_md, x.base_md_version,
            p.active_x_account_id
       from x_accounts x
       join profiles p on p.id = x.user_id
      where x.id = $1 and x.user_id = $2
      for update of x, p`,
    [input.xAccountId, input.userId],
  );
  const account = accountResult.rows[0];
  if (!account) throw new AppError("not_found");
  if (
    account.status !== "active" ||
    account.active_x_account_id !== account.id
  ) {
    throw new AppError("job_conflict", {
      details: { reason: "active_x_account_changed" },
    });
  }
  if (account.base_md_version !== input.expectedBaseMdVersion) {
    throw new AppError("job_conflict", {
      details: {
        currentBaseMdVersion: account.base_md_version,
        reason: "base_md_version_changed",
      },
    });
  }

  const activeLearningJob = await client.query(
    `select 1
       from generation_jobs
      where x_account_id = $1
        and kind in ('learning_analysis', 'md_merge')
        and status = 'running'
      limit 1`,
    [account.id],
  );
  if (activeLearningJob.rowCount) {
    throw new AppError("job_conflict", {
      details: { reason: "base_md_learning_in_progress" },
    });
  }

  const baseMd =
    account.base_md_version === 0
      ? generateInitialBaseMd(settings)
      : rebuildSettingsSections(account.base_md, settings);
  const version = account.base_md_version + 1;
  const update = await client.query(
    `update x_accounts
        set settings = $3::jsonb,
            base_md = $4,
            base_md_version = $5
      where id = $1
        and user_id = $2
        and status = 'active'
        and base_md_version = $6`,
    [
      account.id,
      input.userId,
      JSON.stringify(settings),
      baseMd,
      version,
      input.expectedBaseMdVersion,
    ],
  );
  if (update.rowCount !== 1) {
    throw new AppError("job_conflict", {
      details: { reason: "base_md_version_changed" },
    });
  }
  await client.query(
    `insert into base_md_versions
      (x_account_id, version, content, change_source, summary)
     values ($1, $2, $3, 'settings', $4)`,
    [
      account.id,
      version,
      baseMd,
      version === 1 ? "発信設定から初版を作成" : "発信設定からセクション1〜4を更新",
    ],
  );
  return { baseMd, version };
}

export async function updatePersonaSettingsForUser(
  input: UpdatePersonaSettingsInput,
): Promise<UpdatePersonaSettingsResult> {
  return withTransaction((client) => applyPersonaSettingsUpdate(client, input));
}

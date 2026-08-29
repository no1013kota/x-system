import "server-only";

import type { PoolClient } from "pg";

import { applyUpdateBaseMdManual } from "@/lib/base-md";
import { AppError } from "@/lib/observability/errors";

import { withTransaction } from "../db/pool";
import {
  applyCreatePromptPreset,
  applyDeletePromptPreset,
  applySetPromptPresetInUse,
  applyUpdatePromptPreset,
  listPromptPresets,
  type PromptPresetKind,
  type PromptPresetView,
} from "./prompt-presets";
import { assertPromptEditablePlan, resolvePromptTemplate } from "./prompt-templates";

/**
 * プロンプトの本棚の server-only 配線（T-M8-332）。
 *
 * **「使用中」を書き換えたら、生成が読む置き場へ同じtxで写す**（`mirror`）。
 * 別txにすると、写す前に落ちたときに**画面は新しい文字・生成は古い文字**という、
 * 利用者から説明できない食い違いが残る。
 */

interface AccountRow {
  base_md: string;
  base_md_version: number;
  plan: string;
}

async function loadAccount(
  client: PoolClient,
  userId: string,
  xAccountId: string,
): Promise<AccountRow> {
  const { rows } = await client.query<AccountRow>(
    `select x.base_md, x.base_md_version, p.plan
       from x_accounts x join profiles p on p.id = x.user_id
      where x.id = $1 and x.user_id = $2 and x.status = 'active'`,
    [xAccountId, userId],
  );
  if (!rows[0]) throw new AppError("not_found", { details: { reason: "x_account_not_found" } });
  return rows[0];
}

/**
 * 使用中の内容を、生成が実際に読む置き場へ写す。
 *
 * - `base_md`: `x_accounts.base_md`（既存の手動編集と同じ経路。**版と履歴を残す**ので、
 *   切り替えの前へいつでも戻せる。学習running中は同じ理由で拒否される）
 * - `image`: `prompt_templates`（`x_account_id`, `kind='image'`）の上書き行
 */
function mirrorFor(
  client: PoolClient,
  params: { userId: string; xAccountId: string; kind: PromptPresetKind },
): (content: string) => Promise<void> {
  return async (content: string) => {
    if (params.kind === "base_md") {
      const account = await loadAccount(client, params.userId, params.xAccountId);
      if (account.base_md === content) return;
      await applyUpdateBaseMdManual(client, {
        userId: params.userId,
        xAccountId: params.xAccountId,
        content,
        expectedVersion: account.base_md_version,
      });
      return;
    }
    await client.query(
      `insert into prompt_templates (x_account_id, kind, content)
       values ($1, 'image', $2)
       on conflict (x_account_id, kind) where x_account_id is not null
       do update set content = excluded.content, updated_at = now()
        where prompt_templates.content is distinct from excluded.content`,
      [params.xAccountId, content],
    );
  };
}

/** いま生成に使われている内容（本棚が空のときの1件目の元）。 */
async function effectiveContent(
  client: PoolClient,
  params: { userId: string; xAccountId: string; kind: PromptPresetKind },
): Promise<string> {
  if (params.kind === "base_md") {
    const account = await loadAccount(client, params.userId, params.xAccountId);
    return account.base_md_version >= 1 ? account.base_md : "";
  }
  return resolvePromptTemplate(client, { xAccountId: params.xAccountId, kind: "image" });
}

/**
 * 書き込みの共通ゲート。**アカウントの所有とプランをここ1か所で見る**——
 * 各操作で書き分けると、片方だけ緩い経路が残る。
 */
async function assertWritable(
  client: PoolClient,
  params: { userId: string; xAccountId: string },
): Promise<void> {
  const account = await loadAccount(client, params.userId, params.xAccountId);
  assertPromptEditablePlan(account.plan);
}

export function listPromptPresetsForUser(params: {
  userId: string;
  xAccountId: string;
  kind: PromptPresetKind;
}): Promise<PromptPresetView[]> {
  // 1件目の作成が要ることがあるので書けるtxで包む（読むだけのときは何も書かない）。
  return withTransaction(async (client) => {
    await loadAccount(client, params.userId, params.xAccountId);
    const fallbackContent = await effectiveContent(client, params);
    return listPromptPresets(client, {
      xAccountId: params.xAccountId,
      kind: params.kind,
      fallbackContent,
    });
  });
}

export function createPromptPresetForUser(params: {
  userId: string;
  xAccountId: string;
  kind: PromptPresetKind;
  name: string;
  content: string;
}): Promise<PromptPresetView> {
  return withTransaction(async (client) => {
    await assertWritable(client, params);
    return applyCreatePromptPreset(client, params);
  });
}

export function updatePromptPresetForUser(params: {
  userId: string;
  xAccountId: string;
  presetId: string;
  name: string;
  content: string;
  expectedUpdatedAt: string;
}): Promise<PromptPresetView> {
  return withTransaction(async (client) => {
    await assertWritable(client, params);
    return applyUpdatePromptPreset(
      client,
      params,
      mirrorFor(client, { ...params, kind: await presetKind(client, params) }),
    );
  });
}

export function setPromptPresetInUseForUser(params: {
  userId: string;
  xAccountId: string;
  presetId: string;
}): Promise<PromptPresetView> {
  return withTransaction(async (client) => {
    await assertWritable(client, params);
    return applySetPromptPresetInUse(
      client,
      params,
      mirrorFor(client, { ...params, kind: await presetKind(client, params) }),
    );
  });
}

export function deletePromptPresetForUser(params: {
  userId: string;
  xAccountId: string;
  presetId: string;
}): Promise<{ deletedName: string }> {
  return withTransaction(async (client) => {
    await assertWritable(client, params);
    return applyDeletePromptPreset(client, params);
  });
}

/** 対象の区分（写す先を決めるのに要る）。所有は `x_account_id` 一致で担保。 */
async function presetKind(
  client: PoolClient,
  params: { xAccountId: string; presetId: string },
): Promise<PromptPresetKind> {
  const { rows } = await client.query<{ kind: PromptPresetKind }>(
    `select kind from prompt_presets where id = $1 and x_account_id = $2`,
    [params.presetId, params.xAccountId],
  );
  if (!rows[0]) throw new AppError("not_found", { details: { reason: "preset_not_found" } });
  return rows[0].kind;
}

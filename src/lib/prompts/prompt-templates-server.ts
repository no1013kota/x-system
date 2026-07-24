import "server-only";

import { getPool, withTransaction } from "../db/pool";
import { env } from "../env";
import { resolveActiveXAccountForUser } from "../x/account-actions-server";
import type { Queryable } from "../x/token-refresh";
import type { PromptTemplateKind } from "./gen-prompts";
import {
  applyResetPromptTemplate,
  applyUpdatePromptTemplate,
  listPromptTemplates,
  type PromptTemplateView,
} from "./prompt-templates";

/**
 * プロンプトテンプレート編集の server-only 配線（M-2/M-3, 要件05 §8, T-M5-10）。active Xアカウントを
 * 解決し、profiles.plan と FEATURE_QUOTE_POST_ENABLED を中核へ渡す。書き込みは withTransaction で束ねる。
 */

const pooledDb: Queryable = {
  query: <T = unknown>(sql: string, params?: unknown[]) =>
    getPool().query(sql, params) as unknown as Promise<{ rows: T[]; rowCount: number | null }>,
};

async function planForUser(userId: string): Promise<string> {
  const row = (
    await pooledDb.query<{ plan: string }>(`select plan from profiles where id = $1`, [userId])
  ).rows[0];
  return row?.plan ?? "standard";
}

export interface PromptTemplatesForUser {
  xAccountId: string | null;
  plan: string;
  quotePostEnabled: boolean;
  templates: PromptTemplateView[];
}

/** active アカウントのテンプレート合成＋plan/flagを返す。アカウント未選択なら templates は空。 */
export async function listPromptTemplatesForUser(userId: string): Promise<PromptTemplatesForUser> {
  const [xAccountId, plan] = await Promise.all([
    resolveActiveXAccountForUser(userId),
    planForUser(userId),
  ]);
  const templates = xAccountId ? await listPromptTemplates(pooledDb, xAccountId) : [];
  return { xAccountId, plan, quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED, templates };
}

export async function updatePromptTemplateForUser(input: {
  userId: string;
  kind: PromptTemplateKind;
  content: string;
  expectedUpdatedAt: string | null;
}): Promise<PromptTemplateView> {
  const [xAccountId, plan] = await Promise.all([
    resolveActiveXAccountForUser(input.userId),
    planForUser(input.userId),
  ]);
  if (!xAccountId) throw new NoActiveAccountError();
  return withTransaction((client) =>
    applyUpdatePromptTemplate(client as unknown as Queryable, {
      xAccountId,
      kind: input.kind,
      content: input.content,
      expectedUpdatedAt: input.expectedUpdatedAt,
      plan,
      quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
    }),
  );
}

export async function resetPromptTemplateForUser(input: {
  userId: string;
  kind: PromptTemplateKind;
}): Promise<PromptTemplateView> {
  const [xAccountId, plan] = await Promise.all([
    resolveActiveXAccountForUser(input.userId),
    planForUser(input.userId),
  ]);
  if (!xAccountId) throw new NoActiveAccountError();
  return withTransaction((client) =>
    applyResetPromptTemplate(client as unknown as Queryable, {
      xAccountId,
      kind: input.kind,
      plan,
      quotePostEnabled: env.FEATURE_QUOTE_POST_ENABLED,
    }),
  );
}

/** active Xアカウント未選択（設定導線が必要）。Action で not_found へ変換する。 */
export class NoActiveAccountError extends Error {
  constructor() {
    super("no_active_x_account");
    this.name = "NoActiveAccountError";
  }
}

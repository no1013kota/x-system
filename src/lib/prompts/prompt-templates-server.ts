import "server-only";

import { pooledQueryable, runInPooledTx } from "../db/pool";
import { env } from "../env";
import { AppError } from "../observability/errors";
import { resolveActiveXAccountForUser } from "../x/account-actions-server";

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

const pooledDb = pooledQueryable();

async function planForUser(userId: string): Promise<string> {
  const row = (
    await pooledDb.query<{ plan: string | null }>(`select plan from profiles where id = $1`, [
      userId,
    ])
  ).rows[0];
  // 未契約（NULL）を 'standard' へ潰さない（T-M8-168で standard は編集可になったため、
  // 潰すと未契約ロックがこの経路だけすり抜ける）。空文字は PLANS に無く編集不可と判定される。
  return row?.plan ?? "";
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
  /** 画面が表示していたアカウント。activeと不一致なら拒否（別アカウントへの誤保存防止・T-M8-196）。 */
  expectedXAccountId: string;
  content: string;
  expectedUpdatedAt: string | null;
}): Promise<PromptTemplateView> {
  const [xAccountId, plan] = await Promise.all([
    resolveActiveXAccountForUser(input.userId),
    planForUser(input.userId),
  ]);
  if (!xAccountId) throw new NoActiveAccountError();
  if (xAccountId !== input.expectedXAccountId) {
    throw new AppError("job_conflict", { details: { reason: "x_account_mismatch" } });
  }
  return runInPooledTx((tx) =>
    applyUpdatePromptTemplate(tx, {
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
  /** 画面が表示していたアカウント。activeと不一致なら拒否（別アカウントの削除防止・T-M8-196）。 */
  expectedXAccountId: string;
}): Promise<PromptTemplateView> {
  const [xAccountId, plan] = await Promise.all([
    resolveActiveXAccountForUser(input.userId),
    planForUser(input.userId),
  ]);
  if (!xAccountId) throw new NoActiveAccountError();
  if (xAccountId !== input.expectedXAccountId) {
    throw new AppError("job_conflict", { details: { reason: "x_account_mismatch" } });
  }
  return runInPooledTx((tx) =>
    applyResetPromptTemplate(tx, {
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

import "server-only";

import { pooledQueryable, runInPooledTx } from "../db/pool";
import { assertPromptEditablePlan } from "../prompts/prompt-templates";
import { resolveActiveXAccountForUser } from "../x/account-actions-server";

import {
  applyCreatePattern,
  applyDeletePattern,
  applyRestoreDefaultPatterns,
  applyUpdatePattern,
  applyUpdatePatternPrompt,
  listPatternPrompts,
  listPatterns,
  type PatternInput,
  type PatternOption,
  type PatternPromptView,
} from "./post-patterns-store";

/**
 * 投稿パターンの server-only 配線（T-M8-129 U3/U4・ADR-0008）。
 *
 * active Xアカウントを解決し、`profiles.plan` を見て編集の可否を決める。
 * **プロンプトの編集境界は `prompt_templates` と同じ**（mdプラン以上）——
 * 同じ「プロンプトを直す」操作で画面によって可否が違うと利用者は理由を説明できない。
 */

const pooledDb = pooledQueryable();

/** active Xアカウントが選ばれていない。呼び出し側で `not_found`（設定導線）へ変換する。 */
export class NoActiveAccountError extends Error {
  constructor() {
    super("no active x account");
    this.name = "NoActiveAccountError";
  }
}

async function planForUser(userId: string): Promise<string> {
  const row = (
    await pooledDb.query<{ plan: string }>(`select plan from profiles where id = $1`, [userId])
  ).rows[0];
  return row?.plan ?? "standard";
}

async function requireAccount(userId: string): Promise<{ xAccountId: string; plan: string }> {
  const [xAccountId, plan] = await Promise.all([
    resolveActiveXAccountForUser(userId),
    planForUser(userId),
  ]);
  if (!xAccountId) throw new NoActiveAccountError();
  return { xAccountId, plan };
}

export interface PatternsForUser {
  xAccountId: string | null;
  plan: string;
  patterns: PatternOption[];
  /** パターンID → プロンプト本文。standard には渡さない（編集できないため）。 */
  prompts: Record<string, PatternPromptView>;
}

/** 一覧＋プロンプト＋planを返す。アカウント未選択なら空で返す（画面が導線を出す）。 */
export async function listPatternsForUser(userId: string): Promise<PatternsForUser> {
  const [xAccountId, plan] = await Promise.all([
    resolveActiveXAccountForUser(userId),
    planForUser(userId),
  ]);
  if (!xAccountId) return { xAccountId: null, plan, patterns: [], prompts: {} };
  const [patterns, prompts] = await Promise.all([
    listPatterns(pooledDb, xAccountId),
    listPatternPrompts(pooledDb, xAccountId),
  ]);
  return { xAccountId, plan, patterns, prompts };
}

export async function updatePatternPromptForUser(input: {
  userId: string;
  patternId: string;
  content: string;
  expectedUpdatedAt: string | null;
}): Promise<PatternPromptView> {
  const { xAccountId, plan } = await requireAccount(input.userId);
  assertPromptEditablePlan(plan);
  return runInPooledTx((tx) =>
    applyUpdatePatternPrompt(tx, {
      xAccountId,
      patternId: input.patternId,
      content: input.content,
      expectedUpdatedAt: input.expectedUpdatedAt,
    }),
  );
}

export async function createPatternForUser(input: {
  userId: string;
  pattern: PatternInput;
}): Promise<PatternOption> {
  const { xAccountId, plan } = await requireAccount(input.userId);
  assertPromptEditablePlan(plan);
  return runInPooledTx((tx) => applyCreatePattern(tx, { ...input.pattern, xAccountId }));
}

export async function updatePatternForUser(input: {
  userId: string;
  patternId: string;
  pattern: PatternInput;
}): Promise<PatternOption> {
  const { xAccountId, plan } = await requireAccount(input.userId);
  assertPromptEditablePlan(plan);
  return runInPooledTx((tx) =>
    applyUpdatePattern(tx, { ...input.pattern, xAccountId, patternId: input.patternId }),
  );
}

export async function deletePatternForUser(input: {
  userId: string;
  patternId: string;
}): Promise<{ deletedName: string; disabledSlots: number }> {
  const { xAccountId, plan } = await requireAccount(input.userId);
  assertPromptEditablePlan(plan);
  return runInPooledTx((tx) => applyDeletePattern(tx, { xAccountId, patternId: input.patternId }));
}

export async function restoreDefaultPatternsForUser(userId: string): Promise<number> {
  const { xAccountId, plan } = await requireAccount(userId);
  assertPromptEditablePlan(plan);
  return runInPooledTx((tx) => applyRestoreDefaultPatterns(tx, xAccountId));
}

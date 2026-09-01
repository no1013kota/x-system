"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { errorResult, requireExecutionUserId, type BaseResult } from "./_helpers";
import { resolveTextProvider } from "@/lib/ai/resolve-provider-server";
import { recordProviderCalls } from "@/lib/db/api-usage-ledger";
import { pooledQueryable, withTransaction } from "@/lib/db/pool";
import { createDeadline } from "@/lib/jobs/deadline";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import {
  PATTERN_GEN_MAX_POSTS,
  PATTERN_GEN_POST_MAX_CHARS,
  generatePatternFromExamples,
} from "@/lib/prompts/pattern-prompt-gen";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";
import { reserveIfPremium, settleIfPremium } from "@/lib/usage/reserve-if-premium";
import { parseUserInput } from "@/lib/validation/user-input";

/**
 * 参考投稿から投稿作成プロンプトを生成する（T-M8-397・運営者の指示 2026-09-01）。
 *
 * **同期のServer Actionで実行する**（jobにしない）。結果は保存せずフォームの記入欄へ
 * 返すだけで、保存の判断は利用者に残る——失敗しても押し直せばよく、リトライ管理が要らない。
 * 費用は原価台帳（recordProviderCalls）とAIクレジット（settleIfPremium）へ記録する。
 */

const inputSchema = z.object({
  x_account_id: z.string().uuid(),
  reference_posts: z
    .array(z.string().trim().min(1).max(PATTERN_GEN_POST_MAX_CHARS))
    .min(1, "参考投稿を1件以上入力してください。")
    .max(PATTERN_GEN_MAX_POSTS),
  hint: z.string().trim().max(200).default(""),
});

export interface GeneratePatternPromptResult extends BaseResult {
  name?: string;
  description?: string;
  prompt?: string;
}

const pooledDb = pooledQueryable();

export async function generatePatternPromptAction(
  input: unknown,
): Promise<GeneratePatternPromptResult> {
  const parsed = parseUserInput(inputSchema, input);
  if (!parsed.success) {
    const error = toUserFacingError(new AppError("validation_error"));
    return { ...error, status: "error" };
  }
  const auth = await requireExecutionUserId();
  if (!auth.ok) return auth.result;

  try {
    // 対象アカウントの所有・active と、プロンプト編集が使えるプランかを確かめる。
    const { rows } = await pooledDb.query<{ id: string; plan: string | null }>(
      `select xa.id, p.plan
         from x_accounts xa join profiles p on p.id = xa.user_id
        where xa.id = $1 and xa.user_id = $2 and xa.status = 'active'`,
      [parsed.data.x_account_id, auth.userId],
    );
    const account = rows[0];
    if (!account) throw new AppError("not_found");
    const plan = account.plan ?? "";
    if (!promptEditablePlan(plan)) {
      throw new AppError("forbidden", {
        message: "プロンプトの編集は、ご契約のプランでは利用できません。",
      });
    }

    /*
      生成1回ぶんの識別子。jobは作らないが、クレジット精算（settleUsage）と
      台帳の冪等キーは「1回の実行」単位のIDを要る。
    */
    const genId = randomUUID();
    // 残量が尽きていれば開始前に断る（premium/expertのみ。BYOKは no-op）。
    await reserveIfPremium((fn) => withTransaction(fn), {
      plan,
      userId: auth.userId,
      xAccountId: account.id,
      jobId: genId,
      type: "generation",
    });

    const deadline = createDeadline();
    // 「観察して判断する」処理なので analysis 層のモデルへ固定（プロンプト設計書 §3）。
    const provider = await resolveTextProvider(
      { plan: plan as never, userId: auth.userId },
      { deadline, purpose: "analysis" },
    );
    const result = await generatePatternFromExamples(provider, {
      posts: parsed.data.reference_posts,
      hint: parsed.data.hint,
      deadline,
    });

    // 成否に関わらず、発生したcallは台帳へ（原則4: 費用が見える）。
    await recordProviderCalls(pooledDb, result.calls, {
      userId: auth.userId,
      xAccountId: account.id,
      jobId: null,
      keyPrefix: `patgen:${genId}`,
    });
    const total = result.calls.reduce((sum, c) => sum + (c.estimated_cost_usd ?? 0), 0);
    await settleIfPremium((fn) => withTransaction(fn), {
      plan,
      // jobは作らないので job_id は入れない（FK）。冪等キーで1回の実行を表す。
      jobId: null,
      idempotencyKey: `patgen:${genId}:charge`,
      type: "generation",
      estimatedCostUsdTotal: total,
      userId: auth.userId,
      xAccountId: account.id,
    });

    if (!result.ok) {
      return { message: result.reason ?? "生成できませんでした。", status: "error" };
    }
    return {
      message: "プロンプトを作成しました。内容を確認して保存してください。",
      status: "success",
      name: result.name,
      description: result.description,
      prompt: result.prompt,
    };
  } catch (error) {
    return errorResult(error);
  }
}

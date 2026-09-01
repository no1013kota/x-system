"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { errorResult, requireExecutionUserId, type BaseResult } from "./_helpers";
import { resolveTextProvider } from "@/lib/ai/resolve-provider-server";
import { recordProviderCalls } from "@/lib/db/api-usage-ledger";
import { pooledQueryable, withTransaction } from "@/lib/db/pool";
import { createDeadline } from "@/lib/jobs/deadline";
import { AppError, toUserFacingError } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import {
  PATTERN_GEN_MAX_POSTS,
  PATTERN_GEN_MODEL_PURPOSE,
  PATTERN_GEN_POST_MAX_CHARS,
  generatePatternFromExamples,
} from "@/lib/prompts/pattern-prompt-gen";
import { resolveReferencePosts } from "@/lib/prompts/pattern-reference-posts";
import { promptEditablePlan } from "@/lib/prompts/prompt-templates";
import { reserveIfPremium, settleIfPremium } from "@/lib/usage/reserve-if-premium";
import { parseUserInput } from "@/lib/validation/user-input";
import { isXAuthError } from "@/lib/x/client";
import { readTweetMetrics } from "@/lib/x/read-client";
import { buildXReadDeps } from "@/lib/x/read-client-server";
import { getValidXAccessToken } from "@/lib/x/token-refresh-server";

/**
 * 参考投稿から投稿作成プロンプトを生成する（T-M8-397・運営者の指示 2026-09-01）。
 *
 * **同期のServer Actionで実行する**（jobにしない）。結果は保存せずフォームの記入欄へ
 * 返すだけで、保存の判断は利用者に残る——失敗しても押し直せばよく、リトライ管理が要らない。
 * 費用は原価台帳（recordProviderCalls）とAIクレジット（settleIfPremium）へ記録する。
 *
 * **参考投稿はX投稿のURLでもよい**（T-M8-399・運営者の報告 2026-09-01）。URLは対象アカウントの
 * user token で本文へ引き直し（学習分析の `fetchReferencePost` と同じ経路・X読取も台帳へ）、
 * AIには本文だけを渡す。読めなかったURLは理由つきで断り、読めた分だけで生成しない。
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

const X_ACCOUNTS_SETTINGS_PATH = "/app/settings?tab=x-accounts";

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
    // 残量が尽きていれば開始前に断る（premium/expertのみ。BYOKは no-op）。Xを読む前に見る。
    await reserveIfPremium((fn) => withTransaction(fn), {
      plan,
      userId: auth.userId,
      xAccountId: account.id,
      jobId: genId,
      type: "generation",
    });

    /*
      URLを本文へ引き直す（T-M8-399）。X読取は `readTweetMetrics` が原価台帳へ記録する。
      X未連携・token失効・X側の拒否は、**どの操作で直せるか**まで添えて断る（原則2）。
    */
    const references = await resolveReferencePosts(parsed.data.reference_posts, async (tweetIds) => {
      const accessToken = await getValidXAccessToken(account.id).catch((error: unknown) => {
        throw new ReferenceFetchError(
          "X投稿のURLを読み取るには、有効なX連携が必要です（連携が切れている可能性があります）。本文を貼り付けるか、設定＞Xアカウントから再連携してください。",
          error,
        );
      });
      const readDeps = buildXReadDeps(accessToken, {
        userId: auth.userId,
        xAccountId: account.id,
        jobId: null,
      });
      try {
        const { tweets } = await readTweetMetrics(readDeps, {
          tweetIds,
          idempotencyKeyBase: `patgen:${genId}:ref`,
        });
        return new Map(tweets.map((t) => [t.id, t.text]));
      } catch (error) {
        throw new ReferenceFetchError(
          isXAuthError(error)
            ? "Xが投稿の読み取りを拒否しました（連携の許可が切れている可能性があります）。設定＞Xアカウントから再連携してください。"
            : "Xから投稿を取得できませんでした。時間をおいて再度お試しいただくか、本文を貼り付けてください。",
          error,
        );
      }
    });
    if (!references.ok) {
      return { message: references.reason, status: "error" };
    }

    const deadline = createDeadline();
    // 「観察して判断する」処理なので analysis 層のモデルへ固定（Anthropic=Claude Sonnet 5・T-M8-399）。
    const provider = await resolveTextProvider(
      { plan: plan as never, userId: auth.userId },
      { deadline, purpose: PATTERN_GEN_MODEL_PURPOSE },
    );
    const result = await generatePatternFromExamples(provider, {
      posts: references.posts,
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
    if (error instanceof ReferenceFetchError) {
      // X側の失敗は利用者の操作で直る種類が多いが、原因は記録して追えるようにする（原則1）。
      recordUnexpectedError(error.cause, { at: "pattern-prompt:reference-fetch" });
      return {
        message: error.message,
        status: "error",
        code: "provider_error",
        details: { settingsPath: X_ACCOUNTS_SETTINGS_PATH },
      };
    }
    return errorResult(error);
  }
}

/** X投稿の取得に失敗したときの利用者向け理由（原因は cause に保持）。 */
class ReferenceFetchError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = "ReferenceFetchError";
  }
}

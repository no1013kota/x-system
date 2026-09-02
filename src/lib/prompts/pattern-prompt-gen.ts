import { z } from "zod";

import { parseAndValidate } from "@/lib/ai/parse";
import { toProviderCall, type ProviderCall } from "@/lib/ai/normalize";
import { estimateProviderCost } from "@/lib/ai/pricing";
import type { TextGen } from "@/lib/ai/types";
import type { Deadline } from "@/lib/jobs/deadline";
import { extractPlaceholderNames } from "@/lib/post/pattern-spec";
import { PATTERN_PROMPT_MAX_CHARS } from "@/lib/post/post-patterns-store";

import { PT_PATTERN_GEN } from "./gen-prompts";

/**
 * 参考投稿から投稿作成プロンプトを生成する（T-M8-397・運営者の指示 2026-09-01）。
 *
 * パターン追加フォーム（プロンプト・投稿作成・スケジュールの3画面共通）の
 * 「参考投稿からAIで作る」が呼ぶ。出力はフォームの記入欄へそのまま入り、
 * 保存の判断は利用者に残る（勝手に保存しない）。
 *
 * md-merge と同じ「直接呼び＋読めなければ1回だけ直させる」形。Web検索は使わない
 * （素材は貼られた参考投稿だけ。外を見に行くと分析対象が変わってしまう）。
 */

export const PATTERN_GEN_MAX_POSTS = 3;
/**
 * 生成に使うモデルの層（T-M8-399・運営者の指示 2026-09-01「sonnet5で固定」）。
 * `analysis` 層は Anthropic では `claude-sonnet-5` に固定される（`PURPOSE_TEXT_MODELS`）。
 * BYOKでOpenAI/Googleしか無い利用者はClaudeを呼べないため、同格の analysis 層モデルになる。
 * 対応はテスト（pattern-prompt-gen.test.ts）で守る。
 */
export const PATTERN_GEN_MODEL_PURPOSE = "analysis" as const;
/** 参考投稿1件の受理上限。Xの長文上限（25,000加重）を全角で超える貼り付けは弾く。 */
export const PATTERN_GEN_POST_MAX_CHARS = 15_000;

const outputSchema = z.object({
  name: z.string().max(30),
  description: z.string().max(60),
  prompt: z.string().max(PATTERN_PROMPT_MAX_CHARS),
  error: z.string().nullable().optional(),
});

export interface PatternPromptGenResult {
  ok: boolean;
  name: string;
  description: string;
  prompt: string;
  /** ok=false の理由（利用者へそのまま出せる日本語）。 */
  reason: string | null;
  calls: ProviderCall[];
}

export async function generatePatternFromExamples(
  provider: { textGen: TextGen; model: string },
  input: { posts: string[]; hint: string; deadline: Deadline },
  now: () => number = Date.now,
): Promise<PatternPromptGenResult> {
  const calls: ProviderCall[] = [];
  const user = [
    `<reference_posts>\n${JSON.stringify(input.posts)}\n</reference_posts>`,
    `<hint>\n${input.hint.trim() || "（なし）"}\n</hint>`,
  ].join("\n\n");

  const call = async (extra: string): Promise<string> => {
    const start = now();
    const out = await provider.textGen.generate({
      system: [PT_PATTERN_GEN],
      user: extra ? `${user}\n\n${extra}` : user,
      timeoutMs: input.deadline.callTimeoutMs(),
    });
    calls.push(
      toProviderCall(out, {
        model: provider.model,
        operation: "text_generation",
        latencyMs: now() - start,
        estimatedCostUsd: estimateProviderCost(out.provider, out.usage),
      }),
    );
    return out.text.trim();
  };

  const parse = (text: string): z.infer<typeof outputSchema> | null => {
    const parsed = parseAndValidate(text, outputSchema);
    return parsed.ok ? parsed.value : null;
  };

  let out = parse(await call(""));
  if (!out) {
    // 読めない出力は1回だけ直させる（md-merge と同じ方針・プロンプト設計書 §7.1）。
    out = parse(
      await call(
        "前回の出力はJSONとして読めませんでした。指定の形のJSONだけを出力し直してください。",
      ),
    );
  }
  if (!out) {
    return {
      ok: false,
      name: "",
      description: "",
      prompt: "",
      reason: "AIの出力を読み取れませんでした。時間をおいて再度お試しください。",
      calls,
    };
  }
  if (out.error || !out.prompt.trim()) {
    return {
      ok: false,
      name: "",
      description: "",
      prompt: "",
      reason: out.error?.trim() || "参考投稿から型を読み取れませんでした。",
      calls,
    };
  }
  /*
    プレースホルダーは最大10個までフォームが入力欄にする（T-M8-186）。AIが穴だらけの
    プロンプトを返したら、入力欄が使い物にならないので受け取らない。
  */
  // extractPlaceholderNames は既定で10個に丸めるため、超過検出は上限+1で数え直す。
  if (extractPlaceholderNames(out.prompt, 11).length > 10) {
    return {
      ok: false,
      name: "",
      description: "",
      prompt: "",
      reason: "生成されたプロンプトの入力項目が多すぎました。再度お試しください。",
      calls,
    };
  }
  return {
    ok: true,
    name: out.name.trim(),
    description: out.description.trim(),
    prompt: out.prompt.trim(),
    reason: null,
    calls,
  };
}

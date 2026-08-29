import { AppError } from "@/lib/observability/errors";
import { PLANS, type PlanId } from "@/lib/plans";

import { SYSTEM_DEFAULT_TEMPLATES, type PromptTemplateKind } from "./gen-prompts";
import type { Queryable } from "../db/queryable";

/** `prompt_templates` が持ち続ける種別。型プロンプトは `post_patterns` へ移した（U2）。 */
const IMAGE_TEMPLATE_KINDS = ["image"] as const;

/**
 * prompt_templates の system default seed と解決（要件02 §3.5, T-M3-02）。DBは注入し純粋に保つ。
 * system default（x_account_id=null）はコード定数を正としてseedで冪等に同期する。account上書き
 * （x_account_id=当該）があればそれを優先し、なければsystem default、無ければコード定数へフォールバック。
 *
 * **画像プロンプトの一覧・保存・既定へ戻すはここには無い**（T-M8-332）。複数持てるように
 * なったので、読み書きは本棚（`prompt-presets.ts`／`prompt-presets-server.ts`）が担い、
 * 使用中の1件だけがこの表の上書き行へ写される。ここに残るのは**生成が使う解決**と
 * system default の同期、プランと本文の検証だけ。
 */

/**
 * system default（`kind='image'`）を冪等にseed/同期する。**変更があった件数**を返す。
 *
 * コード定数が正本で、DB行はその写し。`scheduler_tick` から毎回呼ぶため、内容が同じときは
 * 更新しない（`updated_at` を無駄に動かさない。編集画面の楽観lockにも影響する）。
 *
 * これを自動で呼ぶ理由（T-M7-37）: 解決順は「account上書き → system default行 → コード定数」で、
 * **DB行があるとコード定数の変更が反映されない**。以前はこの関数がテストからしか呼ばれておらず、
 * プロンプトを直しても古い行が使われ続ける状態だった（人が思い出して実行する手順にしない・原則3）。
 *
 * **型プロンプト（p1〜p6）はここでは扱わない**（T-M8-129 U2）。正本は `post_patterns.prompt` で、
 * null ならコード定数 `SYSTEM_DEFAULT_TEMPLATES` を使う。行を作らないので同じ問題が起きない。
 */
export async function seedSystemPromptTemplates(db: Queryable): Promise<number> {
  let applied = 0;
  for (const kind of IMAGE_TEMPLATE_KINDS) {
    const res = await db.query(
      `insert into prompt_templates (x_account_id, kind, content)
       values (null, $1, $2)
       on conflict (kind) where x_account_id is null
       do update set content = excluded.content, updated_at = now()
        where prompt_templates.content is distinct from excluded.content`,
      [kind, SYSTEM_DEFAULT_TEMPLATES[kind]],
    );
    applied += res.rowCount ?? 0;
  }
  return applied;
}

/**
 * system default（x_account_id=null）の本文を返す共通の末尾フォールバック。行が無ければ
 * コード定数（`SYSTEM_DEFAULT_TEMPLATES`）を返す。上書き非存在時の解決で共有する。
 */
async function systemTemplateContent(
  db: Queryable,
  kind: PromptTemplateKind,
): Promise<string> {
  const system = (
    await db.query<{ content: string }>(
      `select content from prompt_templates where x_account_id is null and kind = $1`,
      [kind],
    )
  ).rows[0];
  return system?.content ?? SYSTEM_DEFAULT_TEMPLATES[kind];
}

/**
 * **画像プロンプト**の本文を解決する。account上書き→system default→コード定数の順に落ちる。
 * xAccountId=null なら system default（無ければコード定数）を返す。ホットパス用に本文のみ読む。
 *
 * **型プロンプトはここでは解決できない**（T-M8-129 U2）。正本は `post_patterns.prompt` で、
 * 生成はジョブに凍結された `pattern_spec` から `patternPrompt()` で取る。誤って
 * ここへ型を渡すと「上書きしたのに効かない」状態になるため、kind を `"image"` へ絞る。
 */
export async function resolvePromptTemplate(
  db: Queryable,
  params: { xAccountId: string | null; kind: "image" },
): Promise<string> {
  if (params.xAccountId) {
    const override = (
      await db.query<{ content: string }>(
        `select content from prompt_templates where x_account_id = $1 and kind = $2`,
        [params.xAccountId, params.kind],
      )
    ).rows[0];
    if (override) return override.content;
  }
  return systemTemplateContent(db, params.kind);
}

export const PROMPT_TEMPLATE_MAX_CHARS = 8000;

export interface PromptTemplateView {
  kind: PromptTemplateKind;
  content: string;
  /** account上書きが存在する（=カスタム）か。false は system default 表示。 */
  isOverride: boolean;
  /** 上書き行の updated_at（ISO・ms精度）。楽観lockの expected_updated_at。未上書きは null。 */
  updatedAt: string | null;
}

/** md/premium 以外は編集不可（standard は forbidden・要件06 §9）。 */
/**
 * プロンプトを編集できるプランか（T-M8-135）。
 *
 * **判定はここだけに置く。** 保存時の拒否（`assertPromptEditablePlan`）と、
 * 実行時に枠の `prompt_override` を使うかの判定（`schedule-enqueue`）が別々の条件を持つと、
 * 「画面には出ないのに生成では効く」状態が生まれる。
 */
export function promptEditablePlan(plan: string): boolean {
  // **出典は `PLANS` の表**（T-M8-144）。以前はここで plan 名を直に比べていたため、
  // 料金表の表示（`canEditMdAndPrompts`）と保存時の拒否が別系統で、
  // プランの権限を変えても片方だけ追随しうる状態だった。未知planは false。
  return PLANS[plan as PlanId]?.canEditMdAndPrompts === true;
}

export function assertPromptEditablePlan(plan: string): void {
  if (!promptEditablePlan(plan)) {
    throw new AppError("forbidden", { details: { reason: "plan_not_allowed" } });
  }
}

/** p5（引用ポスト）は FEATURE_QUOTE_POST_ENABLED=false の間は編集/リセット不可（要件05 §8）。 */
export function assertPromptKindAllowed(kind: PromptTemplateKind, quotePostEnabled: boolean): void {
  if (kind === "p5" && !quotePostEnabled) {
    throw new AppError("feature_disabled", { details: { feature: "quote_post" } });
  }
}

/** 8,000字上限・空文字拒否（違反は validation_error）。 */
export function validatePromptContent(content: string): void {
  if (content.trim().length === 0) {
    throw new AppError("validation_error", { details: { reason: "empty" } });
  }
  if (content.length > PROMPT_TEMPLATE_MAX_CHARS) {
    throw new AppError("validation_error", {
      details: { reason: "too_long", max: PROMPT_TEMPLATE_MAX_CHARS, length: content.length },
    });
  }
}

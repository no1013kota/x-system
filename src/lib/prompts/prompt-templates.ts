import { AppError } from "@/lib/observability/errors";

import {
  PROMPT_TEMPLATE_KINDS,
  SYSTEM_DEFAULT_TEMPLATES,
  type PromptTemplateKind,
} from "./gen-prompts";
import type { Queryable } from "../db/queryable";

/**
 * prompt_templates の system default seed と解決（要件02 §3.5, T-M3-02）。DBは注入し純粋に保つ。
 * system default（x_account_id=null）はコード定数を正としてseedで冪等に同期する。account上書き
 * （x_account_id=当該）があればそれを優先し、なければsystem default、無ければコード定数へフォールバック。
 * 手動編集（list/update/reset）の中核は要件05 §8/§9・T-M5-10。md/premium のみ更新可、p1〜p6/image・
 * 8,000字上限・expected_updated_at 楽観lock。p5 は FEATURE_QUOTE_POST_ENABLED=false の間 feature_disabled。
 */

/** system default 7件（kind=p1〜p6/image）を冪等にseed/同期する。適用件数を返す。 */
export async function seedSystemPromptTemplates(db: Queryable): Promise<number> {
  let applied = 0;
  for (const kind of PROMPT_TEMPLATE_KINDS) {
    const res = await db.query(
      `insert into prompt_templates (x_account_id, kind, content)
       values (null, $1, $2)
       on conflict (kind) where x_account_id is null
       do update set content = excluded.content, updated_at = now()`,
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
 * テンプレート本文を解決する。account上書き→system default→コード定数の順にフォールバックする。
 * xAccountId=null なら system default（無ければコード定数）を返す。ホットパス用に本文のみ読む。
 */
export async function resolvePromptTemplate(
  db: Queryable,
  params: { xAccountId: string | null; kind: PromptTemplateKind },
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

function toIso(v: Date | string): string {
  return typeof v === "string" ? new Date(v).toISOString() : v.toISOString();
}

/** md/premium 以外は編集不可（standard は forbidden・要件06 §9）。 */
export function assertPromptEditablePlan(plan: string): void {
  if (plan !== "md" && plan !== "premium") {
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

/**
 * kind=p1〜p6/image を system default（x_account_id=null）＋account上書きで合成して返す。
 * 上書きがあれば content=上書き・isOverride=true・updatedAt=上書き行のupdated_at、
 * なければ system default（無ければコード定数）・isOverride=false・updatedAt=null。
 */
export async function listPromptTemplates(
  db: Queryable,
  xAccountId: string,
): Promise<PromptTemplateView[]> {
  const [overrides, systems] = await Promise.all([
    db.query<{ kind: string; content: string; updated_at: Date | string }>(
      `select kind, content, updated_at from prompt_templates where x_account_id = $1`,
      [xAccountId],
    ),
    db.query<{ kind: string; content: string }>(
      `select kind, content from prompt_templates where x_account_id is null`,
    ),
  ]);
  const ov = new Map(overrides.rows.map((r) => [r.kind, r]));
  const sys = new Map(systems.rows.map((r) => [r.kind, r.content]));
  return PROMPT_TEMPLATE_KINDS.map((kind) => {
    const o = ov.get(kind);
    if (o) return { kind, content: o.content, isOverride: true, updatedAt: toIso(o.updated_at) };
    return {
      kind,
      content: sys.get(kind) ?? SYSTEM_DEFAULT_TEMPLATES[kind],
      isOverride: false,
      updatedAt: null,
    };
  });
}

async function getPromptTemplateView(
  db: Queryable,
  xAccountId: string,
  kind: PromptTemplateKind,
): Promise<PromptTemplateView> {
  const override = (
    await db.query<{ content: string; updated_at: Date | string }>(
      `select content, updated_at from prompt_templates where x_account_id = $1 and kind = $2`,
      [xAccountId, kind],
    )
  ).rows[0];
  if (override) {
    return { kind, content: override.content, isOverride: true, updatedAt: toIso(override.updated_at) };
  }
  return { kind, content: await systemTemplateContent(db, kind), isOverride: false, updatedAt: null };
}

/**
 * account上書きを作成/更新する。plan/kindを検証し8,000字上限を確認、expected_updated_at で楽観lock。
 * expected_updated_at=null は新規作成（既に存在すれば job_conflict）、非nullは ms精度一致時のみ更新。
 */
export async function applyUpdatePromptTemplate(
  db: Queryable,
  input: {
    xAccountId: string;
    kind: PromptTemplateKind;
    content: string;
    expectedUpdatedAt: string | null;
    plan: string;
    quotePostEnabled: boolean;
  },
): Promise<PromptTemplateView> {
  assertPromptEditablePlan(input.plan);
  assertPromptKindAllowed(input.kind, input.quotePostEnabled);
  validatePromptContent(input.content);

  if (input.expectedUpdatedAt === null) {
    const ins = await db.query(
      `insert into prompt_templates (x_account_id, kind, content)
       values ($1, $2, $3)
       on conflict (x_account_id, kind) where x_account_id is not null do nothing`,
      [input.xAccountId, input.kind, input.content],
    );
    if ((ins.rowCount ?? 0) !== 1) {
      throw new AppError("job_conflict", { details: { reason: "prompt_template_changed" } });
    }
  } else {
    const upd = await db.query(
      `update prompt_templates set content = $3
        where x_account_id = $1 and kind = $2
          and date_trunc('milliseconds', updated_at) = $4::timestamptz`,
      [input.xAccountId, input.kind, input.content, input.expectedUpdatedAt],
    );
    if ((upd.rowCount ?? 0) !== 1) {
      throw new AppError("job_conflict", { details: { reason: "prompt_template_changed" } });
    }
  }
  return getPromptTemplateView(db, input.xAccountId, input.kind);
}

/** account上書きを削除し system default へ戻す（冪等）。plan/kindを検証。 */
export async function applyResetPromptTemplate(
  db: Queryable,
  input: { xAccountId: string; kind: PromptTemplateKind; plan: string; quotePostEnabled: boolean },
): Promise<PromptTemplateView> {
  assertPromptEditablePlan(input.plan);
  assertPromptKindAllowed(input.kind, input.quotePostEnabled);
  await db.query(`delete from prompt_templates where x_account_id = $1 and kind = $2`, [
    input.xAccountId,
    input.kind,
  ]);
  return getPromptTemplateView(db, input.xAccountId, input.kind);
}

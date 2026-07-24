import {
  PROMPT_TEMPLATE_KINDS,
  SYSTEM_DEFAULT_TEMPLATES,
  type PromptTemplateKind,
} from "./gen-prompts";
import type { Queryable } from "../x/token-refresh";

/**
 * prompt_templates の system default seed と解決（要件02 §3.5, T-M3-02）。DBは注入し純粋に保つ。
 * system default（x_account_id=null）はコード定数を正としてseedで冪等に同期する。account上書き
 * （x_account_id=当該）があればそれを優先し、なければsystem default、無ければコード定数へフォールバック。
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
 * テンプレートを解決する。account上書き→system default→コード定数の順にフォールバックする。
 * xAccountId=null なら system default（無ければコード定数）を返す。
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
  const system = (
    await db.query<{ content: string }>(
      `select content from prompt_templates where x_account_id is null and kind = $1`,
      [params.kind],
    )
  ).rows[0];
  return system?.content ?? SYSTEM_DEFAULT_TEMPLATES[params.kind];
}

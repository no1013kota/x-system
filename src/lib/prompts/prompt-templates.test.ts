import { describe, expect, it } from "vitest";

import { PLANS, PLAN_IDS } from "@/lib/plans";

import { AppError } from "../observability/errors";
import { PT_P1, SYSTEM_DEFAULT_TEMPLATES } from "./gen-prompts";
import {
  PROMPT_TEMPLATE_MAX_CHARS,
  assertPromptEditablePlan,
  assertPromptKindAllowed,
  listPromptTemplates,
  resolvePromptTemplate,
  validatePromptContent,  promptEditablePlan,
} from "./prompt-templates";
import type { Queryable } from "../x/token-refresh";

function makeDb(handler: (sql: string, params: unknown[]) => unknown[]): Queryable {
  return {
    query: async <T = unknown>(sql: string, params: unknown[] = []) => {
      const rows = handler(sql, params) as T[];
      return { rows, rowCount: rows.length };
    },
  };
}

const isAccount = (sql: string) => /x_account_id = \$1 and kind/.test(sql);
const isSystem = (sql: string) => /x_account_id is null and kind/.test(sql);

// 型プロンプトはここでは解決しない（正本は `post_patterns.prompt`・T-M8-129 U2）。
describe("resolvePromptTemplate（画像プロンプト）", () => {
  it("prefers the account override", async () => {
    const db = makeDb((sql) => (isAccount(sql) ? [{ content: "CUSTOM" }] : []));
    expect(await resolvePromptTemplate(db, { xAccountId: "a1", kind: "image" })).toBe("CUSTOM");
  });

  it("falls back to the system default when no override", async () => {
    const db = makeDb((sql) => (isSystem(sql) ? [{ content: "SYS" }] : []));
    expect(await resolvePromptTemplate(db, { xAccountId: "a1", kind: "image" })).toBe("SYS");
  });

  it("skips the override query entirely when xAccountId is null", async () => {
    let accountQueried = false;
    const db = makeDb((sql) => {
      if (isAccount(sql)) accountQueried = true;
      return isSystem(sql) ? [{ content: "SYS" }] : [];
    });
    expect(await resolvePromptTemplate(db, { xAccountId: null, kind: "image" })).toBe("SYS");
    expect(accountQueried).toBe(false);
  });

  it("falls back to the code constant when the DB has no row", async () => {
    const db = makeDb(() => []);
    expect(await resolvePromptTemplate(db, { xAccountId: "a1", kind: "image" })).toBe(
      SYSTEM_DEFAULT_TEMPLATES.image,
    );
    // 型プロンプトのコード定数も引き続き正本（生成は `post_patterns.prompt` が null のとき使う）。
    expect(SYSTEM_DEFAULT_TEMPLATES.p1).toBe(PT_P1);
  });
});

function codeOf(fn: () => void): { code: string; reason?: unknown } {
  try {
    fn();
  } catch (e) {
    const err = e as AppError;
    return { code: err.code, reason: err.details?.reason };
  }
  throw new Error("expected throw");
}

describe("prompt template guards", () => {
  it("assertPromptEditablePlan は全プラン許可・未知/未契約は forbidden（T-M8-168）", () => {
    expect(() => assertPromptEditablePlan("standard")).not.toThrow();
    expect(() => assertPromptEditablePlan("premium")).not.toThrow();
    expect(() => assertPromptEditablePlan("expert")).not.toThrow();
    // 旧standard（編集不可）は撤廃。falseになるのは未知・未契約(null→""を渡す)だけ。
    expect(codeOf(() => assertPromptEditablePlan("")).code).toBe("forbidden");
    expect(codeOf(() => assertPromptEditablePlan("md")).code).toBe("forbidden");
  });

  it("assertPromptKindAllowed blocks p5 only when quote-post disabled", () => {
    expect(() => assertPromptKindAllowed("p5", true)).not.toThrow();
    expect(() => assertPromptKindAllowed("p1", false)).not.toThrow();
    expect(codeOf(() => assertPromptKindAllowed("p5", false)).code).toBe("feature_disabled");
  });

  it("validatePromptContent rejects empty and over-limit", () => {
    expect(() => validatePromptContent("ok")).not.toThrow();
    expect(codeOf(() => validatePromptContent("   ")).reason).toBe("empty");
    expect(codeOf(() => validatePromptContent("x".repeat(PROMPT_TEMPLATE_MAX_CHARS + 1))).reason).toBe("too_long");
  });
});

describe("listPromptTemplates", () => {
  /**
   * **画像プロンプトだけを返す**（T-M8-139・ADR-0008・要件05 §8）。
   *
   * 以前は `p1`〜`p6` も返していた。そのため画像プロンプトの編集画面で「再読み込み」を押すと
   * 一覧の先頭が p1 になって**編集対象がすり替わり、保存すると投稿パターンのプロンプトを
   * 画像プロンプトの本文で上書きした**。型プロンプトの読み出しは `listPatternPrompts` が担う。
   */
  it("画像だけを返す（型プロンプトは post_patterns 側の経路）", async () => {
    const db = makeDb(() => []);
    const views = await listPromptTemplates(db, "a1");
    expect(views.map((v) => v.kind)).toEqual(["image"]);
    // 上書きもsystem行も無い → コード定数へ落ちる。
    expect(views[0]).toMatchObject({
      content: SYSTEM_DEFAULT_TEMPLATES.image,
      isOverride: false,
      updatedAt: null,
    });
  });

  it("アカウント上書きがあれば custom を返す", async () => {
    const db = makeDb((sql) => {
      if (/from prompt_templates where x_account_id = \$1/.test(sql)) {
        return [{ kind: "image", content: "CUSTOM IMG", updated_at: "2026-07-24T00:00:00.000Z" }];
      }
      return [];
    });
    const views = await listPromptTemplates(db, "a1");
    expect(views).toEqual([
      {
        kind: "image",
        content: "CUSTOM IMG",
        isOverride: true,
        updatedAt: "2026-07-24T00:00:00.000Z",
      },
    ]);
  });

  it("post_patterns を読まない（型プロンプトはこの経路の関心事ではない）", async () => {
    const seen: string[] = [];
    const db = makeDb((sql) => {
      seen.push(sql);
      return [];
    });
    await listPromptTemplates(db, "a1");
    expect(seen.some((s) => /post_patterns/.test(s)), "post_patterns を引いている").toBe(false);
  });
});

/**
 * T-M8-144。**「md/premium だけ編集できる」の判定の出典を1つにする。**
 *
 * 以前は `promptEditablePlan` が plan 名を直に比べており、料金表の表示
 * （`PLANS[].canEditMdAndPrompts`）と保存時の拒否が別系統だった。
 * プランの権限を変えたとき片方だけ追随する形で、
 * 「表では編集できると書いてあるのに保存できない」（逆も）が起きうる。
 */
describe("プロンプト編集の可否は PLANS の表を出典にする", () => {
  it("現行3プランで表の値と一致する", () => {
    for (const id of PLAN_IDS) {
      expect(promptEditablePlan(id), `${id}`).toBe(PLANS[id].canEditMdAndPrompts);
    }
  });

  it("未知のplanは編集不可（黙って許さない）", () => {
    expect(promptEditablePlan("unknown")).toBe(false);
    expect(promptEditablePlan("")).toBe(false);
  });

  it("表を1プランだけ反転させると判定も追随する（出典が1つである証拠）", () => {
    // standard は編集不可。表だけを一時的に反転させ、判定が同じ値を返すことを見る。
    const original = PLANS.standard.canEditMdAndPrompts;
    try {
      (PLANS.standard as { canEditMdAndPrompts: boolean }).canEditMdAndPrompts = true;
      expect(promptEditablePlan("standard"), "表を変えたのに判定が追随していない").toBe(true);
    } finally {
      (PLANS.standard as { canEditMdAndPrompts: boolean }).canEditMdAndPrompts = original;
    }
  });
});

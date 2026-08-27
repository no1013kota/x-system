import { describe, expect, it } from "vitest";


import { AppError } from "../observability/errors";
import { PT_P1, SYSTEM_DEFAULT_TEMPLATES } from "./gen-prompts";
import {
  PROMPT_TEMPLATE_MAX_CHARS,
  assertPromptEditablePlan,
  assertPromptKindAllowed,
  resolvePromptTemplate,
  validatePromptContent,} from "./prompt-templates";
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

import { describe, expect, it } from "vitest";

import { AppError } from "../observability/errors";
import { PT_P1, SYSTEM_DEFAULT_TEMPLATES } from "./gen-prompts";
import {
  PROMPT_TEMPLATE_MAX_CHARS,
  assertPromptEditablePlan,
  assertPromptKindAllowed,
  listPromptTemplates,
  resolvePromptTemplate,
  validatePromptContent,
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

describe("resolvePromptTemplate", () => {
  it("prefers the account override", async () => {
    const db = makeDb((sql) => (isAccount(sql) ? [{ content: "CUSTOM" }] : []));
    expect(await resolvePromptTemplate(db, { xAccountId: "a1", kind: "p1" })).toBe("CUSTOM");
  });

  it("falls back to the system default when no override", async () => {
    const db = makeDb((sql) => (isSystem(sql) ? [{ content: "SYS" }] : []));
    expect(await resolvePromptTemplate(db, { xAccountId: "a1", kind: "p1" })).toBe("SYS");
  });

  it("skips the override query entirely when xAccountId is null", async () => {
    let accountQueried = false;
    const db = makeDb((sql) => {
      if (isAccount(sql)) accountQueried = true;
      return isSystem(sql) ? [{ content: "SYS" }] : [];
    });
    expect(await resolvePromptTemplate(db, { xAccountId: null, kind: "p2" })).toBe("SYS");
    expect(accountQueried).toBe(false);
  });

  it("falls back to the code constant when the DB has no row", async () => {
    const db = makeDb(() => []);
    expect(await resolvePromptTemplate(db, { xAccountId: "a1", kind: "p1" })).toBe(
      SYSTEM_DEFAULT_TEMPLATES.p1,
    );
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
  it("assertPromptEditablePlan allows md/premium, forbids standard", () => {
    expect(() => assertPromptEditablePlan("md")).not.toThrow();
    expect(() => assertPromptEditablePlan("premium")).not.toThrow();
    expect(codeOf(() => assertPromptEditablePlan("standard")).code).toBe("forbidden");
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
  it("composes overrides over system defaults for all 7 kinds", async () => {
    const db = makeDb((sql) => {
      if (/x_account_id = \$1/.test(sql)) {
        return [{ kind: "p1", content: "CUSTOM P1", updated_at: "2026-07-24T00:00:00.000Z" }];
      }
      if (/x_account_id is null/.test(sql)) {
        return [{ kind: "p2", content: "SYS P2" }];
      }
      return [];
    });
    const views = await listPromptTemplates(db, "a1");
    expect(views).toHaveLength(7);
    const p1 = views.find((v) => v.kind === "p1")!;
    expect(p1).toMatchObject({ content: "CUSTOM P1", isOverride: true, updatedAt: "2026-07-24T00:00:00.000Z" });
    const p2 = views.find((v) => v.kind === "p2")!;
    expect(p2).toMatchObject({ content: "SYS P2", isOverride: false, updatedAt: null });
    // no override, no system row → code constant
    const image = views.find((v) => v.kind === "image")!;
    expect(image).toMatchObject({ content: SYSTEM_DEFAULT_TEMPLATES.image, isOverride: false, updatedAt: null });
  });
});

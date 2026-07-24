import { describe, expect, it, vi } from "vitest";

import { BASE_MD_MAX_CHARS, isLearningRunning, validateManualBaseMd } from "./base-md";
import { AppError } from "./observability/errors";

const VALID = `# 発信定義書

## 1. ペルソナ
- 発信者: A

## 2. 発信テーマ
- 主テーマ: AI

## 3. トーン&マナー
- 文末: です・ます調

## 4. やらないこと
- 煽らない

## 5. 文体・自分らしさ
実例

## 6. 参考にする型
型
`;

function code(fn: () => void): { code: string; reason?: unknown } {
  try {
    fn();
  } catch (e) {
    const err = e as AppError;
    return { code: err.code, reason: err.details?.reason };
  }
  throw new Error("expected throw");
}

describe("validateManualBaseMd", () => {
  it("accepts a well-formed 6-section document", () => {
    expect(() => validateManualBaseMd(VALID)).not.toThrow();
  });

  it("rejects content over 5,000 chars (too_long)", () => {
    const long = VALID + "x".repeat(BASE_MD_MAX_CHARS);
    const r = code(() => validateManualBaseMd(long));
    expect(r.code).toBe("validation_error");
    expect(r.reason).toBe("too_long");
  });

  it("rejects a missing heading (structure)", () => {
    const missing = VALID.replace("## 6. 参考にする型\n型\n", "");
    const r = code(() => validateManualBaseMd(missing));
    expect(r.code).toBe("validation_error");
    expect(r.reason).toBe("structure");
  });

  it("rejects a duplicated heading (structure)", () => {
    const dup = VALID.replace("## 5. 文体・自分らしさ", "## 3. トーン&マナー");
    expect(code(() => validateManualBaseMd(dup)).reason).toBe("structure");
  });

  it("rejects out-of-order headings (structure)", () => {
    const swapped = `## 2. b\n\n## 1. a\n\n## 3. c\n\n## 4. d\n\n## 5. e\n\n## 6. f\n`;
    expect(code(() => validateManualBaseMd(swapped)).reason).toBe("structure");
  });
});

describe("isLearningRunning", () => {
  it("scopes to owner + learning/md_merge running and returns true when a row exists", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 });
    expect(await isLearningRunning({ query }, "user-1", "acct-1")).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("kind in ('learning_analysis', 'md_merge')");
    expect(sql).toContain("status = 'running'");
    expect(sql).toContain("x.user_id = $2");
    expect(params).toEqual(["acct-1", "user-1"]);
  });

  it("returns false when no running job", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await isLearningRunning({ query }, "user-1", "acct-1")).toBe(false);
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WRITING_CHECKPOINTS } from "./writing-checkpoints";

/**
 * プロンプト設計書 §6.17 の表（ID・画面の名前・AI への条項）がコードの正本と一致すること（T-M8-447）。
 * 文面を直したら docs も直す。ずれたまま気付かない状態を作らない（docs/README §3 の方針）。
 */
describe("プロンプト設計書 §6.17 と WRITING_CHECKPOINTS の一致", () => {
  it("表の行がカタログと同じ順・同じ文面", () => {
    const doc = readFileSync("docs/プロンプト設計書.md", "utf8");
    const start = doc.indexOf("### 6.17 書き方のチェックポイント");
    expect(start, "設計書 §6.17 が無い").toBeGreaterThan(-1);
    const section = doc.slice(start, doc.indexOf("\n## ", start));
    const rows = section
      .split("\n")
      .filter((line) => /^\| (ai|buzz)-\d+ \|/.test(line))
      .map((line) =>
        line
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean),
      );
    expect(rows.map((r) => r[0])).toEqual(WRITING_CHECKPOINTS.map((c) => c.id));
    for (const [i, c] of WRITING_CHECKPOINTS.entries()) {
      expect(rows[i]?.[1], `${c.id} の画面の名前`).toBe(c.label);
      expect(rows[i]?.[2], `${c.id} の条項`).toBe(c.instruction);
    }
  });
});

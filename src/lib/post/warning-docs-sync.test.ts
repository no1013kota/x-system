import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WARNING_LABEL } from "./warning-labels";

/**
 * 要件06 の警告一覧が**実装の画面ラベルと一致している**こと（T-M8-85）。
 *
 * 正本は実装と一致していなければならない（CLAUDE.md 最重要ルール）が、確かめるものが無く、
 * 実際に**要件06 が「引用対象不明」を警告として挙げているのに対応するコードが無い**状態が残っていた
 * （引用対象の解決は §5・要件04 §10 step3 が「失敗させる」と定めており、警告ではない）。
 * 逆に実装側で足したラベル（長め・ポスト数を調整）は要件06 に無かった。
 *
 * 名前の照合だけを行う（説明文の言い回しまでは縛らない）。
 */

const DOC = readFileSync(
  fileURLToPath(new URL("../../../docs/requirements/06_screens_onboarding_posting.md", import.meta.url)),
  "utf8",
);

/** 「…はポストまたは下書き単位の警告として表示する」の行から警告名を取り出す。 */
function documentedWarnings(): string[] {
  const line = DOC.split("\n").find((l) => l.includes("ポストまたは下書き単位の警告として表示する"));
  if (!line) return [];
  const head = line.slice(0, line.indexOf("はポストまたは下書き単位"));
  return head
    .replace(/^-\s*/, "")
    .split("、")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("要件06の警告一覧と実装ラベル", () => {
  it("列挙が取り出せる（検査が空振りしていない）", () => {
    expect(documentedWarnings().length).toBeGreaterThan(3);
  });

  it("要件06に載っている警告はすべて実装のラベルに存在する", () => {
    const labels = new Set(Object.values(WARNING_LABEL));
    const missing = documentedWarnings().filter((name) => !labels.has(name));
    expect(
      missing,
      "要件06 にあって実装に無い警告。実装するか、要件06 から外してください",
    ).toEqual([]);
  });

  it("実装のラベルはすべて要件06に載っている", () => {
    const documented = new Set(documentedWarnings());
    const undocumented = Object.values(WARNING_LABEL).filter((label) => !documented.has(label));
    expect(
      undocumented,
      "実装にあって要件06 に無い警告。正本へ追記してください",
    ).toEqual([]);
  });
});

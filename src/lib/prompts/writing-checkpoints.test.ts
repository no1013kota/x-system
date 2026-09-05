import { describe, expect, it } from "vitest";

import { SYS_GEN } from "./gen-prompts";
import {
  composeBaseMdWithCheckpoints,
  normalizeWritingCheckpointIds,
  renderWritingCheckpoints,
  WRITING_CHECKPOINT_GROUPS,
  WRITING_CHECKPOINTS,
  WRITING_CHECKPOINTS_HEADING,
} from "./writing-checkpoints";

/** 書き方のチェックポイント（T-M8-447）。文面の正本はコードなので、形と規則をここで固定する。 */
describe("writing checkpoints catalog", () => {
  it("ID は一意で `<group>-<n>` の形、群は ai / buzz の2つ", () => {
    const ids = WRITING_CHECKPOINTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of WRITING_CHECKPOINTS) {
      expect(c.id).toMatch(new RegExp(`^${c.group}-\\d+$`));
      expect(Object.keys(WRITING_CHECKPOINT_GROUPS)).toContain(c.group);
      expect(c.label.length).toBeLessThanOrEqual(24);
      expect(c.description.length).toBeLessThanOrEqual(60);
      expect(c.instruction.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("両群に条項があり、効果を約束する語を含まない", () => {
    expect(WRITING_CHECKPOINTS.some((c) => c.group === "ai")).toBe(true);
    expect(WRITING_CHECKPOINTS.some((c) => c.group === "buzz")).toBe(true);
    for (const c of WRITING_CHECKPOINTS) {
      expect(`${c.label}${c.description}${c.instruction}`).not.toMatch(
        /必ず伸びる|保証|No\.1|バズる/,
      );
    }
  });

  it("SYS-GEN に既にある規則（ハッシュタグ・本文のURL）を重ねない", () => {
    for (const c of WRITING_CHECKPOINTS) {
      expect(c.instruction).not.toMatch(/ハッシュタグ|URL/);
    }
    expect(SYS_GEN).toMatch(/ハッシュタグ/);
  });
});

describe("normalizeWritingCheckpointIds / render / compose", () => {
  const first = WRITING_CHECKPOINTS[0]!;
  const last = WRITING_CHECKPOINTS[WRITING_CHECKPOINTS.length - 1]!;

  it("配列以外・未知のID・重複を落とし、カタログ順に並べる", () => {
    expect(normalizeWritingCheckpointIds(null)).toEqual([]);
    expect(normalizeWritingCheckpointIds("ai-1")).toEqual([]);
    expect(
      normalizeWritingCheckpointIds([last.id, "nope", first.id, first.id, 3]),
    ).toEqual([first.id, last.id]);
  });

  it("何も選んでいなければ節を出さず、本文だけを返す", () => {
    expect(renderWritingCheckpoints([])).toBe("");
    expect(composeBaseMdWithCheckpoints("# 発信定義\n本文", [])).toBe(
      "# 発信定義\n本文",
    );
  });

  it("選んだ条項を見出し付きで本文の末尾に付ける。本文が空なら節だけ", () => {
    const section = renderWritingCheckpoints([first.id]);
    expect(section.startsWith(`${WRITING_CHECKPOINTS_HEADING}\n- `)).toBe(true);
    expect(section).toContain(first.instruction);
    expect(composeBaseMdWithCheckpoints("本文", [first.id])).toBe(
      `本文\n\n${section}`,
    );
    expect(composeBaseMdWithCheckpoints("", [first.id])).toBe(section);
  });
});

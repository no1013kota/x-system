import { describe, expect, it } from "vitest";

import { IMAGE_MODEL_OPTIONS, TEXT_MODEL_OPTIONS } from "@/lib/ai/model-catalog";
import { PRESET_MAX_COUNT } from "@/lib/prompts/prompt-presets";

import { FIGURE_IMAGE_MODEL_ID, FIGURE_TEXT_MODEL_ID, SHELF_MAX } from "./prompts";

/**
 * 「複数のプロンプトを管理」のカードが描く**事実**を正本と突き合わせる（T-M8-421）。
 *
 * 2026-09-04、LPが「版の数に上限はなく…v1 まで、すべて残る」と描いていたが、本棚は5件で
 * 上限に達すると使用中を書き換える（T-M8-350）。LPは DB 層を import しないため値を写しており、
 * 写した値がずれたらここで止まる。モデル id も同じ（カタログから消えると図版が空欄で黙って描かれる）。
 */
describe("lp-new/prompts: 図版の事実", () => {
  it("本棚の上限は prompt-presets の PRESET_MAX_COUNT と同じ", () => {
    expect(SHELF_MAX).toBe(PRESET_MAX_COUNT.base_md);
  });

  it("図版に出すモデル id はカタログに実在する", () => {
    expect(TEXT_MODEL_OPTIONS.anthropic.some((m) => m.id === FIGURE_TEXT_MODEL_ID)).toBe(true);
    expect(IMAGE_MODEL_OPTIONS.openai.some((m) => m.id === FIGURE_IMAGE_MODEL_ID)).toBe(true);
  });
});

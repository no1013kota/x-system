import { describe, expect, it } from "vitest";

import {
  IMAGE_MODEL_OPTIONS,
  TEXT_MODEL_OPTIONS,
  imageCreditCost,
  textCreditCost,
} from "./model-catalog";

/**
 * クレジット倍数（T-M8-108）: 基準（Sonnet 5相当・画像は最上位）=1、上位はコスト比の切り上げ。
 * ここが崩れると「上位モデル選択で運営原価上限が動かない」という設計保証が壊れる。
 */
describe("credit multipliers", () => {
  it("Anthropicの倍数はコスト比（基準Sonnet 5 $2/$10）の切り上げ", () => {
    expect(textCreditCost("anthropic", "claude-fable-5")).toBe(5); // $10/$50 = 5倍
    expect(textCreditCost("anthropic", "claude-opus-5")).toBe(3); // $5/$25 = 2.5倍 → 切り上げ3
    expect(textCreditCost("anthropic", "claude-sonnet-5")).toBe(1);
    expect(textCreditCost("anthropic", "claude-sonnet-4-6")).toBe(2); // 1.5倍 → 2
    expect(textCreditCost("anthropic", "claude-haiku-4-5")).toBe(1); // 基準未満は1（最低1）
  });

  it("未選択（env既定）・カタログ外は1", () => {
    expect(textCreditCost("anthropic", null)).toBe(1);
    expect(textCreditCost("anthropic", "unknown-model")).toBe(1);
    expect(imageCreditCost("openai", null)).toBe(1);
  });

  it("画像は最上位が基準=1（全モデル1）", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const m of IMAGE_MODEL_OPTIONS[provider]) {
        expect(imageCreditCost(provider, m.id)).toBe(1);
      }
    }
  });

  it("倍数はDB制約（±10）の範囲内", () => {
    for (const options of Object.values(TEXT_MODEL_OPTIONS)) {
      for (const m of options) {
        expect(m.creditMultiplier ?? 1).toBeGreaterThanOrEqual(1);
        expect(m.creditMultiplier ?? 1).toBeLessThanOrEqual(10);
      }
    }
  });
});

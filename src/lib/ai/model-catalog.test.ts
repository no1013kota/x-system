import { describe, expect, it } from "vitest";

import { IMAGE_FLAT_RATES_USD } from "./pricing";
import {
  IMAGE_MODEL_OPTIONS,
  TEXT_MODEL_OPTIONS,
  imageEstimateCredits,
  textEstimateCredits,
} from "./model-catalog";

/**
 * 消費目安（T-M8-110）: estimateCredits は「1回あたりの想定実費（円）」で、
 * 画面表示とreserve見積もりの両方の正本。ここが崩れると表示と仮押さえがずれる。
 */
describe("estimateCredits", () => {
  it("文章の目安は上位ほど高く、最上位（Fable 5）は実測ベースの55", () => {
    expect(textEstimateCredits("anthropic", "claude-fable-5")).toBe(55); // 実測$0.33≒53円
    expect(textEstimateCredits("anthropic", "claude-opus-5")).toBe(30);
    expect(textEstimateCredits("anthropic", "claude-sonnet-5")).toBe(16);
    expect(textEstimateCredits("anthropic", "claude-haiku-4-5")).toBe(10);
  });

  it("Claude Sonnet 4.6 は選択肢に無い（Sonnet 5の下位互換のため掲載しない・T-M8-110）", () => {
    expect(TEXT_MODEL_OPTIONS.anthropic.some((m) => m.id === "claude-sonnet-4-6")).toBe(false);
    // カタログ外の保存済み値は既定見積もりへフォールバック（実行はenv既定モデル）。
    expect(textEstimateCredits("anthropic", "claude-sonnet-4-6")).toBe(16);
  });

  it("未選択（おまかせ）は既定見積もり（文章16・画像12）", () => {
    expect(textEstimateCredits("anthropic", null)).toBe(16);
    expect(imageEstimateCredits("openai", null)).toBe(12);
  });

  it("画像の目安は1枚あたり概算単価表（×160円切り上げ）と一致する", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const m of IMAGE_MODEL_OPTIONS[provider]) {
        const usd = IMAGE_FLAT_RATES_USD[m.id];
        expect(usd, `${m.id} は単価表にあるべき`).toBeDefined();
        expect(m.estimateCredits, `${m.id} の目安が単価表とずれている`).toBe(
          Math.ceil(usd * 160),
        );
      }
    }
  });

  it("ラベルに per MTok 表記を含めない（2026-08-16 運営者の指示）", () => {
    for (const options of [...Object.values(TEXT_MODEL_OPTIONS), ...Object.values(IMAGE_MODEL_OPTIONS)]) {
      for (const m of options) {
        expect(m.label).not.toMatch(/MTok/i);
      }
    }
  });
});

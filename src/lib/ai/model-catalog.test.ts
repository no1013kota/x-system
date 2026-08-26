import { describe, expect, it } from "vitest";

import { creditsFromUsd } from "../usage/ai-credits";

import { IMAGE_FLAT_RATES_USD } from "./pricing";
import {
  IMAGE_MODEL_OPTIONS,
  TEXT_MODEL_OPTIONS,
  imageEstimateCredits,
  textEstimateCredits,
} from "./model-catalog";

/**
 * 消費目安（T-M8-110→T-M8-325）: estimateCredits は「1回あたりの想定実費」で、
 * **単位は 0.01円＝1クレジット**（金額は変えず粒度だけ100倍にした）。
 * 画面表示とreserve見積もりの両方の正本。ここが崩れると表示と仮押さえがずれる。
 */
describe("estimateCredits", () => {
  it("文章の目安は上位ほど高く、最上位（Fable 5）は実測ベースの5,500（＝55円）", () => {
    expect(textEstimateCredits("anthropic", "claude-fable-5")).toBe(5_500); // 実測$0.33≒53円
    expect(textEstimateCredits("anthropic", "claude-opus-5")).toBe(3_000);
    expect(textEstimateCredits("anthropic", "claude-sonnet-5")).toBe(1_600);
    expect(textEstimateCredits("anthropic", "claude-haiku-4-5")).toBe(1_000);
  });

  it("Claude Sonnet 4.6 は選択肢に無い（Sonnet 5の下位互換のため掲載しない・T-M8-110）", () => {
    expect(TEXT_MODEL_OPTIONS.anthropic.some((m) => m.id === "claude-sonnet-4-6")).toBe(false);
    // カタログ外の保存済み値は既定見積もりへフォールバック（実行はenv既定モデル）。
    expect(textEstimateCredits("anthropic", "claude-sonnet-4-6")).toBe(1_600);
  });

  it("未選択（おまかせ）は既定見積もり（文章1,600・画像1,200＝16円・12円）", () => {
    expect(textEstimateCredits("anthropic", null)).toBe(1_600);
    expect(imageEstimateCredits("openai", null)).toBe(1_200);
  });

  it("画像の目安は1枚あたり概算単価表と一致する（換算は creditsFromUsd が正本）", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const m of IMAGE_MODEL_OPTIONS[provider]) {
        const usd = IMAGE_FLAT_RATES_USD[m.id];
        expect(usd, `${m.id} は単価表にあるべき`).toBeDefined();
        expect(m.estimateCredits, `${m.id} の目安が単価表とずれている`).toBe(
          creditsFromUsd(usd),
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

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_MODELS,
  PURPOSE_TEXT_MODELS,
  isCatalogImageModel,
  isCatalogTextModel,
  purposeTextModel,
  type TextModelPurpose,
} from "./model-catalog";
import { MODEL_RATES } from "./pricing";

/**
 * 用途別モデルの固定（T-M8-334）。
 *
 * **裏方の処理を安いモデルへ寄せた効果は、配線が外れると黙って消える。**
 * providerを増やしたときの入れ忘れ、コピー時の purpose 落ちは typecheck では落ちない
 * （どちらも省略可能な引数）。ここで表と配線の両方を見る。
 */

const PURPOSES: TextModelPurpose[] = ["mechanical", "analysis"];

describe("用途別の固定モデル", () => {
  it.each(PURPOSES)("%s は全providerでカタログにあり、単価表も持つ", (purpose) => {
    for (const [provider, model] of Object.entries(PURPOSE_TEXT_MODELS[purpose])) {
      expect(
        isCatalogTextModel(provider as never, model),
        `${provider}/${model} がカタログに無い（画面の表示・見積もりと食い違う）`,
      ).toBe(true);
      expect(
        MODEL_RATES[model],
        `${model} の単価が無いと原価台帳が provider 既定へ落ちて実費とずれる（原則4）`,
      ).toBeDefined();
    }
  });

  it("mechanical は analysis より安い（役割の順序が逆転していない）", () => {
    for (const provider of Object.keys(PURPOSE_TEXT_MODELS.mechanical)) {
      const cheap = MODEL_RATES[PURPOSE_TEXT_MODELS.mechanical[provider as never]];
      const mid = MODEL_RATES[PURPOSE_TEXT_MODELS.analysis[provider as never]];
      expect(cheap.inputPerMTok!).toBeLessThanOrEqual(mid.inputPerMTok!);
      expect(cheap.outputPerMTok!).toBeLessThanOrEqual(mid.outputPerMTok!);
    }
  });

  it("カタログに無いモデルを指定しても差し替えない（null を返す）", () => {
    expect(purposeTextModel("mechanical", "anthropic")).toBe("claude-haiku-4-5");
    expect(purposeTextModel("analysis", "anthropic")).toBe("claude-sonnet-5");
  });

  it("画像の既定はカタログにあり、より高い選択肢も残っている", () => {
    for (const [provider, model] of Object.entries(DEFAULT_IMAGE_MODELS)) {
      expect(isCatalogImageModel(provider as never, model)).toBe(true);
    }
    // 既定を安くしても「もっと良い画質」を選べる状態を保つ（運営者の指示 2026-08-27）。
    expect(DEFAULT_IMAGE_MODELS.openai).toBe("gpt-image-1.5");
  });
});

/**
 * **配線が外れていないか**をソースで見る（`create-post-payload.test.ts` と同じ考え方）。
 * `purpose` は省略できる引数なので、消えても型検査は通り、動きも変わらず、
 * **費用だけが静かに元へ戻る**。
 */
describe("裏方の処理は安いモデルへ配線されている", () => {
  const cases: [string, string][] = [
    ["src/lib/jobs/image-generation-server.ts", "mechanical"],
    ["src/lib/jobs/md-merge-server.ts", "mechanical"],
    ["src/lib/jobs/post-generation.ts", "mechanical"],
    ["src/lib/jobs/learning-analysis-server.ts", "analysis"],
  ];

  it.each(cases)("%s は purpose: %s を渡す", (file, purpose) => {
    const src = readFileSync(file, "utf8");
    expect(src, `${file} の purpose 指定が外れている（費用だけ静かに戻る）`).toContain(
      `purpose: "${purpose}"`,
    );
  });

  it("学習分析はMD-MERGEを安いモデルで走らせる（同じjobの中で用途が違う）", () => {
    const src = readFileSync("src/lib/jobs/learning-analysis-server.ts", "utf8");
    expect(src).toContain('purpose: "mechanical"');
    expect(src).toContain("resolveProvider: resolveMergeProvider");
  });
});

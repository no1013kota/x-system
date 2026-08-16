import { loadEnvConfig } from "@next/env";
import { IMAGE_MODEL_OPTIONS, TEXT_MODEL_OPTIONS } from "./model-catalog";
import { describe, expect, it } from "vitest";

import { IMAGE_PROMPT_JSON_SCHEMA } from "../jobs/image-generation";

/**
 * provider契約テスト（**実APIを呼ぶ**。既定では動かない）。
 *
 * 通常のテストは外部APIを全てモックするため、「送っているリクエストがAPIに受理されるか」
 * だけは検証できない。2026-07-27、Anthropic の Web Search tool に `allowed_callers` を
 * 渡していなかったため P-1/P-3/P-4/P-6 と NEWS の生成が常に 400 で失敗していたが、
 * 単体テスト1,237件・E2E 5件・CI のいずれも緑だった（T-M7-15）。この層がその穴を埋める。
 *
 *   npm run check:providers
 *
 * `PROVIDER_CHECK=1` が無ければ1件も実行しない（CIでは常に未実行）。実キーと少額の費用が
 * 必要なため CI へは入れない（[CI](../../../docs/operations/ci.md) §4 の限界）。
 *
 * 方針:
 * - **本番のファクトリをそのまま使う**。ここで独自にペイロードを組むと、検証しているのが
 *   本番の形でなくなり意味が無い。
 * - 応答内容は検証しない（モデル出力は不定）。**受理されること**と正規化が壊れないことだけを見る。
 * - 費用を最小化する（max_tokens 最小・検索を誘発しない指示・画像は1枚）。
 */

// `@/lib/env` は import 時に検証するため、対象モジュールより先に .env.local を流し込む。
const testNodeEnv = process.env.NODE_ENV;
Reflect.set(process.env, "NODE_ENV", "development");
Object.assign(process.env, loadEnvConfig(process.cwd(), true, console, true).combinedEnv);
if (testNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
else Reflect.set(process.env, "NODE_ENV", testNodeEnv);

const ENABLED = process.env.PROVIDER_CHECK === "1";

/**
 * Google は既定で検査しない。2026-07-27 時点で運営キーのquotaが枯渇（429）し、画像は
 * `:predict` 呼び出しで404になる（T-M7-17）。常に赤いチェックは読まれなくなり、他providerの
 * 本物の退行を隠すため、**ユーザー判断で一旦対象外**とした。復帰時は
 * `PROVIDER_CHECK_GOOGLE=1 npm run check:providers` で検査する。
 */
const GOOGLE_ENABLED = process.env.PROVIDER_CHECK_GOOGLE === "1";

/** 実行のたびに課金されるので、応答は最小限で足りる。 */
const MINIMAL = {
  system: ["Answer with the single word OK. Do not search unless required."],
  user: "Say OK.",
  timeoutMs: 60_000,
};

/**
 * 構造化出力の検証には **本番が実際に送るschema** を使う。
 *
 * 2026-07-27、ここで独自の最小schemaを使っていたためにPT-IMGのschema不備を見逃した
 * （`additionalProperties` 未指定でAnthropicが400、画像生成が必ず失敗。T-M7-21）。
 * 自前で「正しいschema」を書くと、検証しているのが本番の形でなくなる。
 */
const PRODUCTION_SCHEMAS: Record<string, object> = {
  "PT-IMG（画像プロンプト）": IMAGE_PROMPT_JSON_SCHEMA,
};

function hasKey(name: string): boolean {
  return Boolean(process.env[name]);
}

/**
 * モデルIDの実在検査（T-M8-69）。生成呼び出しは「受理されるか」しか見ないため、
 * **モデルの廃止（404）は実際に生成するまで分からない**。各社のモデル取得APIで、
 * 選択肢として出しているID（`model-catalog.ts`）と運営既定（env）が実在することを確かめる。
 * 課金は発生しない（メタデータの取得のみ）。
 */
const MODEL_ENDPOINT: Record<string, (model: string) => { url: string; headers: Record<string, string> } | null> = {
  anthropic: (model) =>
    process.env.ANTHROPIC_API_KEY
      ? {
          url: `https://api.anthropic.com/v1/models/${model}`,
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
        }
      : null,
  openai: (model) =>
    process.env.OPENAI_API_KEY
      ? {
          url: `https://api.openai.com/v1/models/${model}`,
          headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        }
      : null,
  google: (model) =>
    process.env.GEMINI_API_KEY
      ? {
          url: `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${process.env.GEMINI_API_KEY}`,
          headers: {},
        }
      : null,
};

/** provider → 検査するモデルID（カタログの選択肢＋運営既定のenv）。 */
function modelsToCheck(): { provider: string; model: string; source: string }[] {
  const out: { provider: string; model: string; source: string }[] = [];
  for (const [provider, options] of Object.entries(TEXT_MODEL_OPTIONS)) {
    for (const m of options) out.push({ provider, model: m.id, source: "カタログ(文章)" });
  }
  for (const [provider, options] of Object.entries(IMAGE_MODEL_OPTIONS)) {
    for (const m of options) out.push({ provider, model: m.id, source: "カタログ(画像)" });
  }
  const envModels: [string, string | undefined, string][] = [
    ["anthropic", process.env.ANTHROPIC_TEXT_MODEL, "env既定"],
    ["openai", process.env.OPENAI_TEXT_MODEL, "env既定"],
    ["openai", process.env.OPENAI_IMAGE_MODEL, "env既定"],
    ["google", process.env.GEMINI_TEXT_MODEL, "env既定"],
    ["google", process.env.GEMINI_IMAGE_MODEL, "env既定"],
  ];
  for (const [provider, model, source] of envModels) {
    if (model && !out.some((o) => o.provider === provider && o.model === model)) {
      out.push({ provider, model, source });
    }
  }
  // Googleは既定で検査対象外（上のコメント参照）。キーが無いproviderも飛ばす。
  return out.filter(
    ({ provider }) => (provider !== "google" || GOOGLE_ENABLED) && MODEL_ENDPOINT[provider]?.("x") !== null,
  );
}

describe.runIf(ENABLED)("provider契約（実API）", () => {
  describe("モデルIDの実在（T-M8-69）", () => {
    // 1モデル1テストにする——まとめて1件にすると、どのIDが死んだのか失敗メッセージから分からない。
    for (const { provider, model, source } of modelsToCheck()) {
      it(`${provider} ${model}（${source}）が実在する`, async () => {
        const endpoint = MODEL_ENDPOINT[provider]!(model)!;
        const res = await fetch(endpoint.url, { headers: endpoint.headers });
        expect(
          res.ok,
          `${provider} の ${model} が取得できない（HTTP ${res.status}）。` +
            `モデルが廃止・改名された可能性がある。model-catalog.ts と .env の見直しが要る。`,
        ).toBe(true);
      }, 30_000);
    }
  });

  describe("Anthropic", () => {
    it.runIf(hasKey("ANTHROPIC_API_KEY"))(
      "Web検索付きリクエストが受理される（T-M7-15 の回帰）",
      async () => {
        const { createAnthropicTextGen } = await import("./anthropic-client");
        const gen = createAnthropicTextGen();

        const res = await gen.generate({ ...MINIMAL, webSearch: { maxUses: 1 } });

        expect(res.provider).toBe("anthropic");
        // requestId が取れないと usage 記帳（原価台帳）が成立しない。
        expect(res.requestId).toBeTruthy();
        expect(res.usage.providerCalls).toBeGreaterThan(0);
        expect(res.usage.inputTokens).toBeGreaterThan(0);
      },
      120_000,
    );

    it.runIf(hasKey("ANTHROPIC_API_KEY"))(
      "本番のschemaで構造化出力が受理される",
      async () => {
        const { createAnthropicTextGen } = await import("./anthropic-client");
        const gen = createAnthropicTextGen();

        for (const [label, schema] of Object.entries(PRODUCTION_SCHEMAS)) {
          const res = await gen.generate({ ...MINIMAL, jsonSchema: schema });
          expect(res.provider, label).toBe("anthropic");
          expect(res.text.length, label).toBeGreaterThan(0);
        }
      },
      120_000,
    );
  });

  describe("OpenAI", () => {
    it.runIf(hasKey("OPENAI_API_KEY"))(
      "Web検索付きリクエストが受理される",
      async () => {
        const { createOpenAITextGen } = await import("./openai-client");
        const gen = createOpenAITextGen();

        const res = await gen.generate({ ...MINIMAL, webSearch: { maxUses: 1 } });

        expect(res.provider).toBe("openai");
        expect(res.requestId).toBeTruthy();
      },
      120_000,
    );

    it.runIf(hasKey("OPENAI_API_KEY"))(
      "本番のschemaで構造化出力が受理される",
      async () => {
        const { createOpenAITextGen } = await import("./openai-client");
        const gen = createOpenAITextGen();

        for (const [label, schema] of Object.entries(PRODUCTION_SCHEMAS)) {
          const res = await gen.generate({ ...MINIMAL, jsonSchema: schema });
          expect(res.provider, label).toBe("openai");
        }
      },
      120_000,
    );
  });

  describe.runIf(GOOGLE_ENABLED)("Google", () => {
    it.runIf(hasKey("GEMINI_API_KEY"))(
      "Google Search grounding 付きリクエストが受理される",
      async () => {
        const { createGeminiTextGen } = await import("./gemini-client");
        const gen = createGeminiTextGen();

        const res = await gen.generate({ ...MINIMAL, webSearch: { maxUses: 1 } });

        expect(res.provider).toBe("google");
      },
      120_000,
    );

    it.runIf(hasKey("GEMINI_API_KEY"))(
      "本番のschemaで構造化出力が受理される",
      async () => {
        const { createGeminiTextGen } = await import("./gemini-client");
        const gen = createGeminiTextGen();

        for (const [label, schema] of Object.entries(PRODUCTION_SCHEMAS)) {
          const res = await gen.generate({ ...MINIMAL, jsonSchema: schema });
          expect(res.provider, label).toBe("google");
        }
      },
      120_000,
    );
  });

  /**
   * 画像は1枚あたりの単価がテキストより高い（実行のたびに発生する）。それでも GEN-IMG の
   * リクエスト形状（size/aspectRatio 文字列・応答のデコード）は同じ型の事故を起こすため含める。
   */
  describe("画像生成", () => {
    const IMAGE_REQ = {
      prompt: "A plain light gray background. No text, no objects.",
      aspectRatio: "16:9" as const,
      timeoutMs: 120_000,
    };

    it.runIf(hasKey("OPENAI_API_KEY") && hasKey("OPENAI_IMAGE_MODEL"))(
      "OpenAI が画像を返し、デコードできる",
      async () => {
        const { createOpenAIImageGen } = await import("./image-client");
        const gen = createOpenAIImageGen({
          apiKey: process.env.OPENAI_API_KEY as string,
          model: process.env.OPENAI_IMAGE_MODEL as string,
        });

        const res = await gen.generate(IMAGE_REQ);

        expect(res.provider).toBe("openai");
        expect(res.image.bytes.byteLength).toBeGreaterThan(1000);
      },
      180_000,
    );

    it.runIf(GOOGLE_ENABLED && hasKey("GEMINI_API_KEY") && hasKey("GEMINI_IMAGE_MODEL"))(
      "Gemini が画像を返し、デコードできる",
      async () => {
        const { createGeminiImageGen } = await import("./image-client");
        const gen = createGeminiImageGen({
          apiKey: process.env.GEMINI_API_KEY as string,
          model: process.env.GEMINI_IMAGE_MODEL as string,
        });

        const res = await gen.generate(IMAGE_REQ);

        expect(res.provider).toBe("google");
        expect(res.image.bytes.byteLength).toBeGreaterThan(1000);
      },
      180_000,
    );
  });
});

// 無効時に「0 tests」で静かに緑になるのを避け、何が起きたかを1件で示す。
describe.runIf(!ENABLED)("provider契約（実API）", () => {
  it("PROVIDER_CHECK=1 が無いため未実行（`npm run check:providers` で実行する）", () => {
    expect(ENABLED).toBe(false);
  });
});

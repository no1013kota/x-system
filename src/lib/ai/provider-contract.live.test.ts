import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";

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

/** 実行のたびに課金されるので、応答は最小限で足りる。 */
const MINIMAL = {
  system: ["Answer with the single word OK. Do not search unless required."],
  user: "Say OK.",
  timeoutMs: 60_000,
};

/** 構造化出力の受理だけを見る最小schema。 */
const TINY_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
} as const;

function hasKey(name: string): boolean {
  return Boolean(process.env[name]);
}

describe.runIf(ENABLED)("provider契約（実API）", () => {
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
      "構造化出力（output_config）が受理される",
      async () => {
        const { createAnthropicTextGen } = await import("./anthropic-client");
        const gen = createAnthropicTextGen();

        const res = await gen.generate({ ...MINIMAL, jsonSchema: TINY_SCHEMA });

        expect(res.provider).toBe("anthropic");
        expect(res.text.length).toBeGreaterThan(0);
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
      "構造化出力が受理される",
      async () => {
        const { createOpenAITextGen } = await import("./openai-client");
        const gen = createOpenAITextGen();

        const res = await gen.generate({ ...MINIMAL, jsonSchema: TINY_SCHEMA });

        expect(res.provider).toBe("openai");
      },
      120_000,
    );
  });

  describe("Google", () => {
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
      "構造化出力が受理される",
      async () => {
        const { createGeminiTextGen } = await import("./gemini-client");
        const gen = createGeminiTextGen();

        const res = await gen.generate({ ...MINIMAL, jsonSchema: TINY_SCHEMA });

        expect(res.provider).toBe("google");
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

    it.runIf(hasKey("GEMINI_API_KEY") && hasKey("GEMINI_IMAGE_MODEL"))(
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

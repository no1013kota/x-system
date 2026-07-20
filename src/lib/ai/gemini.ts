import {
  emptyUsage,
  type Citation,
  type TextGen,
  type TextGenRequest,
  type TextGenResult,
} from "./types";

/**
 * Google（Gemini）アダプタの中核（プロンプト設計書 §5.4）。新規実装はInteractions APIを
 * 第一候補とし、選択モデル/必要機能が未対応なら `generateContent` へフォールバックする。
 * どちらも `store=false` 相当で各呼び出しを独立させ、server-side state IDを使わない。
 * Google Search groundingの引用メタデータ・usage・response IDを共通形式へ正規化する。
 * 実SDK配線は `gemini-client.ts`。
 */

export interface RawGeminiParams {
  model: string;
  contents: Array<{ role: "user"; parts: Array<{ text: string }> }>;
  config: {
    systemInstruction?: string;
    tools?: Array<{ googleSearch: object }>;
    responseMimeType?: string;
    responseJsonSchema?: object;
  };
}

interface RawGroundingChunk {
  web?: { uri?: string; title?: string };
}

export interface RawGeminiResponse {
  responseId?: string;
  text?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: RawGroundingChunk[];
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

/** generateContent / Interactions どちらの実SDK呼び出しも満たす注入シグネチャ。 */
export type RawGeminiCall = (
  params: RawGeminiParams,
  opts: { timeoutMs: number },
) => Promise<RawGeminiResponse>;

export interface GeminiTextGenOptions {
  generateContent: RawGeminiCall;
  /** Interactions API呼び出し（第一候補）。未指定または useInteractions=false ならgenerateContentを使う。 */
  interactions?: RawGeminiCall;
  useInteractions?: boolean;
  model: string;
}

export function buildGeminiParams(
  req: TextGenRequest,
  model: string,
): RawGeminiParams {
  const params: RawGeminiParams = {
    model,
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    config: { systemInstruction: req.system.join("\n\n") },
  };
  if (req.webSearch) {
    params.config.tools = [{ googleSearch: {} }];
  } else if (req.jsonSchema) {
    params.config.responseMimeType = "application/json";
    params.config.responseJsonSchema = req.jsonSchema;
  }
  return params;
}

function extractGeminiText(response: RawGeminiResponse): string {
  if (typeof response.text === "string") return response.text;
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text)
    .filter((t): t is string => typeof t === "string")
    .join("");
}

export function extractGeminiCitations(
  response: RawGeminiResponse,
): Citation[] {
  const byUrl = new Map<string, Citation>();
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    const url = chunk.web?.uri;
    if (url && !byUrl.has(url)) {
      const title = chunk.web?.title;
      byUrl.set(url, title ? { url, title } : { url });
    }
  }
  return [...byUrl.values()];
}

export class GeminiTextGen implements TextGen {
  private readonly generateContent: RawGeminiCall;
  private readonly interactions?: RawGeminiCall;
  private readonly useInteractions: boolean;
  private readonly model: string;

  constructor(opts: GeminiTextGenOptions) {
    this.generateContent = opts.generateContent;
    this.interactions = opts.interactions;
    this.useInteractions = opts.useInteractions ?? false;
    this.model = opts.model;
  }

  async generate(req: TextGenRequest): Promise<TextGenResult> {
    // Interactions API優先。未指定/無効ならgenerateContentへフォールバック（設定で制御, §5.4）。
    const call =
      this.useInteractions && this.interactions
        ? this.interactions
        : this.generateContent;
    const response = await call(buildGeminiParams(req, this.model), {
      timeoutMs: req.timeoutMs,
    });

    const usage = emptyUsage();
    usage.inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    usage.outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    usage.cacheReadInputTokens =
      response.usageMetadata?.cachedContentTokenCount ?? 0;
    usage.webSearchRequests =
      response.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
    usage.providerCalls = 1;

    return {
      provider: "google",
      requestId: response.responseId ?? null,
      text: extractGeminiText(response),
      citations: extractGeminiCitations(response),
      usage,
      stopReason: response.candidates?.[0]?.finishReason ?? null,
    };
  }
}

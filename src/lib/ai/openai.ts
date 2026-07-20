import {
  emptyUsage,
  type Citation,
  type TextGen,
  type TextGenRequest,
  type TextGenResult,
} from "./types";

/**
 * OpenAI（ChatGPT）アダプタの中核（プロンプト設計書 §5.3）。Responses APIを使い
 * `store:false` で会話状態を持たせない。`instructions` へSYS+base_md、`input` へ可変入力を渡す。
 * output itemsから text・Web検索引用元・usage・request ID を抽出し共通形式へ正規化する
 * （`output_text` だけを保存して引用を捨てない, §5.1）。実SDK配線は `openai-client.ts`。
 */

export interface RawOpenAIParams {
  model: string;
  instructions: string;
  input: Array<{ role: "user"; content: string }>;
  store: false;
  tools?: Array<{ type: string }>;
  text?: { format: { type: "json_schema"; name: string; schema: object } };
}

interface RawOpenAIAnnotation {
  type: string;
  url?: string;
  title?: string;
}

interface RawOpenAIOutputItem {
  type: string;
  content?: Array<{
    type: string;
    text?: string;
    annotations?: RawOpenAIAnnotation[];
  }>;
}

export interface RawOpenAIResponse {
  id?: string;
  status?: string | null;
  output_text?: string;
  output?: RawOpenAIOutputItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

export type RawResponsesCreate = (
  params: RawOpenAIParams,
  opts: { timeoutMs: number },
) => Promise<RawOpenAIResponse>;

export interface OpenAITextGenOptions {
  create: RawResponsesCreate;
  model: string;
}

export function buildOpenAIParams(
  req: TextGenRequest,
  model: string,
): RawOpenAIParams {
  const params: RawOpenAIParams = {
    model,
    instructions: req.system.join("\n\n"),
    input: [{ role: "user", content: req.user }],
    store: false,
  };
  if (req.webSearch) {
    params.tools = [{ type: "web_search" }];
  } else if (req.jsonSchema) {
    params.text = {
      format: { type: "json_schema", name: "output", schema: req.jsonSchema },
    };
  }
  return params;
}

function extractOpenAIText(response: RawOpenAIResponse): string {
  if (typeof response.output_text === "string") return response.output_text;
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

export function extractOpenAICitations(
  response: RawOpenAIResponse,
): Citation[] {
  const byUrl = new Map<string, Citation>();
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      for (const a of c.annotations ?? []) {
        if (a.type === "url_citation" && a.url && !byUrl.has(a.url)) {
          byUrl.set(a.url, a.title ? { url: a.url, title: a.title } : { url: a.url });
        }
      }
    }
  }
  return [...byUrl.values()];
}

function countWebSearch(response: RawOpenAIResponse): number {
  return (response.output ?? []).filter((i) => i.type === "web_search_call").length;
}

export class OpenAITextGen implements TextGen {
  private readonly create: RawResponsesCreate;
  private readonly model: string;

  constructor(opts: OpenAITextGenOptions) {
    this.create = opts.create;
    this.model = opts.model;
  }

  async generate(req: TextGenRequest): Promise<TextGenResult> {
    const response = await this.create(buildOpenAIParams(req, this.model), {
      timeoutMs: req.timeoutMs,
    });
    const usage = emptyUsage();
    usage.inputTokens = response.usage?.input_tokens ?? 0;
    usage.outputTokens = response.usage?.output_tokens ?? 0;
    usage.cacheReadInputTokens =
      response.usage?.input_tokens_details?.cached_tokens ?? 0;
    usage.webSearchRequests = countWebSearch(response);
    usage.providerCalls = 1;

    return {
      provider: "openai",
      requestId: response.id ?? null,
      text: extractOpenAIText(response),
      citations: extractOpenAICitations(response),
      usage,
      stopReason: response.status ?? null,
    };
  }
}

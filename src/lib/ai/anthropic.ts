import { createDeadline, type Deadline } from "../jobs/deadline";
import { createCitationCollector } from "./citations";
import {
  emptyUsage,
  type Citation,
  type ProviderUsage,
  type TextGen,
  type TextGenRequest,
  type TextGenResult,
} from "./types";

/**
 * Anthropic（Claude）アダプタの中核（プロンプト設計書 §5.1/§5.2/§5.6）。
 * 実SDK呼び出しは `RawCreateMessage` として注入し、この中核はSDK非依存に保つ
 * （pause_turn継続・usage正規化・引用抽出・prompt caching組み立てをここでテストする）。
 * 実SDKとの配線は `anthropic-client.ts`（server-only）で行う。
 *
 * pause_turn規則（§5.2）: 同じtoolsと中断応答を引き継いで**同一generate内でのみ**継続する。
 * 継続は残り時間30秒以上のとき最大2回まで。完了できなければ retryable として扱い（例外）、
 * 次のattemptは新規リクエストとして webSearch.maxUses を1段階縮小して開始する。
 */

/** GEN/NEWSで使うWeb Search toolのversion。環境ではなくアダプタ設定（§5.1「またはアダプタ設定」）。 */
export const DEFAULT_WEB_SEARCH_TOOL_TYPE = "web_search_20260209";
export const DEFAULT_MAX_TOKENS = 8192;
/** pause_turn継続の上限（初回応答後、最大2回まで継続）。 */
export const MAX_PAUSE_TURN_CONTINUATIONS = 2;

// --- 実SDKの最小構造（消費する部分だけ型定義。SDKの正確な引数名は公式型が正） ---

interface RawSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface RawCreateParams {
  model: string;
  max_tokens: number;
  system: RawSystemBlock[];
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  tools?: Array<{
    type: string;
    name: string;
    max_uses?: number;
    allowed_callers?: string[];
  }>;
  output_config?: { format: { type: "json_schema"; schema: object } };
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

interface RawContentBlock {
  type: string;
  text?: string;
  url?: string;
  title?: string;
  content?: unknown;
  citations?: Array<{ url?: string; title?: string }> | null;
  [key: string]: unknown;
}

export interface RawMessageResponse {
  id?: string;
  stop_reason?: string | null;
  content: RawContentBlock[];
  usage?: RawUsage;
}

/** 注入する実SDK呼び出し。opts.timeoutMs はper-call timeout。 */
export type RawCreateMessage = (
  params: RawCreateParams,
  opts: { timeoutMs: number },
) => Promise<RawMessageResponse>;

export interface AnthropicTextGenOptions {
  createMessage: RawCreateMessage;
  model: string;
  webSearchToolType?: string;
  maxTokens?: number;
  /** pause_turn継続の可否判定に使うFunction deadline。未指定なら180秒deadlineを新規作成。 */
  deadline?: Deadline;
  maxContinuations?: number;
}

/** pause_turnがdeadline内に完了しなかった／継続上限に達したことを表す retryable エラー。 */
export class PauseTurnIncompleteError extends Error {
  readonly retryable = true;
  constructor(message = "pause_turn did not complete within the deadline") {
    super(message);
    this.name = "PauseTurnIncompleteError";
  }
}

/**
 * 次attempt用に webSearch.maxUses を1段階縮小する（§5.2「4→2」）。半減・下限1。
 */
export function reduceWebSearchMaxUses(maxUses: number): number {
  return Math.max(1, Math.floor(maxUses / 2));
}

/**
 * 固定ブロック（SYS＋base_md）＋可変messagesからリクエストを組み立てる。
 * systemには可変値を一切入れず、最後の固定ブロックにprompt cachingを適用する（§5.1/§5.2）。
 * Web検索と構造化出力は併用しない（§5.1）: webSearchがあればtools、なければjsonSchemaをoutput_configへ。
 */
export function buildAnthropicParams(
  req: TextGenRequest,
  messages: RawCreateParams["messages"],
  opts: { model: string; webSearchToolType: string; maxTokens: number },
): RawCreateParams {
  /*
    **プロンプトキャッシュは使わない**（T-M8-335・運営者の判断 2026-08-27）。

    キャッシュが当たるのは「同じ並びの入力を5分以内にもう一度送ったとき」だけで、
    キャッシュ対象の先頭ブロックには**そのアカウントのアカウント.md**が入るため、
    他の利用者とは共有されない。1人が5分以内に生成を繰り返すことはほぼ無いので、
    **書いては捨てるだけ**になっていた。キャッシュ書き込みは通常の入力より1.25倍高いので、
    当たらないぶんは純粋な損になる。

    `system` に可変値を入れない作りは**残す**——将来、生成頻度が上がって
    キャッシュが当たるようになったとき、この1行を戻すだけで有効化できる。
  */
  const system: RawSystemBlock[] = req.system.map((text) => ({
    type: "text",
    text,
  }));

  const params: RawCreateParams = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system,
    messages,
  };

  if (req.webSearch) {
    params.tools = [
      {
        type: opts.webSearchToolType,
        name: "web_search",
        max_uses: req.webSearch.maxUses,
        // `web_search_20260209` は allowed_callers を省くと programmatic tool calling を
        // 要求する既定になり、Haiku系（programmatic tool calling 非対応）が 400 を返す。
        // モデルに直接呼ばせる（`direct`）用途しか無いので常に明示する。
        // 2026-07-27: 400 invalid_request_error で P-1/P-3/P-4/P-6 の生成が全滅していた。
        allowed_callers: ["direct"],
      },
    ];
  } else if (req.jsonSchema) {
    params.output_config = {
      format: { type: "json_schema", schema: req.jsonSchema },
    };
  }

  return params;
}

function accumulateUsage(acc: ProviderUsage, raw: RawUsage | undefined): void {
  if (!raw) {
    acc.providerCalls += 1;
    return;
  }
  acc.inputTokens += raw.input_tokens ?? 0;
  acc.outputTokens += raw.output_tokens ?? 0;
  acc.cacheCreationInputTokens += raw.cache_creation_input_tokens ?? 0;
  acc.cacheReadInputTokens += raw.cache_read_input_tokens ?? 0;
  acc.webSearchRequests += raw.server_tool_use?.web_search_requests ?? 0;
  acc.providerCalls += 1;
}

/** content blockからWeb検索引用元を抽出しURLで重複排除する。 */
export function extractCitations(content: RawContentBlock[]): Citation[] {
  const citations = createCitationCollector();
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as RawContentBlock[]) {
        if (r && typeof r.url === "string") citations.add(r.url, r.title);
      }
    }
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) citations.add(c.url, c.title);
    }
  }
  return citations.values();
}

function extractText(content: RawContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

export class AnthropicTextGen implements TextGen {
  private readonly createMessage: RawCreateMessage;
  private readonly model: string;
  private readonly webSearchToolType: string;
  private readonly maxTokens: number;
  private readonly deadline: Deadline;
  private readonly maxContinuations: number;

  constructor(opts: AnthropicTextGenOptions) {
    this.createMessage = opts.createMessage;
    this.model = opts.model;
    this.webSearchToolType = opts.webSearchToolType ?? DEFAULT_WEB_SEARCH_TOOL_TYPE;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.deadline = opts.deadline ?? createDeadline();
    this.maxContinuations = opts.maxContinuations ?? MAX_PAUSE_TURN_CONTINUATIONS;
  }

  async generate(req: TextGenRequest): Promise<TextGenResult> {
    const messages: RawCreateParams["messages"] = [
      { role: "user", content: req.user },
    ];
    const usage = emptyUsage();
    const citations = new Map<string, Citation>();
    let text = "";

    const callTimeout = () =>
      Math.min(req.timeoutMs, this.deadline.callTimeoutMs());

    let response = await this.createMessage(
      buildAnthropicParams(req, messages, {
        model: this.model,
        webSearchToolType: this.webSearchToolType,
        maxTokens: this.maxTokens,
      }),
      { timeoutMs: callTimeout() },
    );
    accumulateUsage(usage, response.usage);
    text += extractText(response.content);
    for (const c of extractCitations(response.content)) citations.set(c.url, c);

    let continuations = 0;
    while (response.stop_reason === "pause_turn") {
      // 継続は残り30秒以上かつ上限未満のときだけ。満たさなければ retryable。
      if (continuations >= this.maxContinuations || !this.deadline.canStartCall()) {
        throw new PauseTurnIncompleteError();
      }
      // 中断応答をassistantとして引き継ぎ、追加のuser messageは足さずに再開する。
      messages.push({ role: "assistant", content: response.content });
      response = await this.createMessage(
        buildAnthropicParams(req, messages, {
          model: this.model,
          webSearchToolType: this.webSearchToolType,
          maxTokens: this.maxTokens,
        }),
        { timeoutMs: callTimeout() },
      );
      accumulateUsage(usage, response.usage);
      text += extractText(response.content);
      for (const c of extractCitations(response.content)) citations.set(c.url, c);
      continuations += 1;
    }

    return {
      provider: "anthropic",
      requestId: response.id ?? null,
      text,
      citations: [...citations.values()],
      usage,
      stopReason: response.stop_reason ?? null,
    };
  }
}

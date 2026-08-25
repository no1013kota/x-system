import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { Deadline } from "../jobs/deadline";
import { env } from "../env";
import {
  AnthropicTextGen,
  type RawCreateMessage,
  type RawMessageResponse,
} from "./anthropic";

export interface AnthropicClientOptions {
  /** BYOK時はユーザー復号キーを渡す。未指定なら運営（env）キー。 */
  apiKey?: string;
  /** 未指定なら env のテキストモデル。 */
  model?: string;
  deadline?: Deadline;
  /** 出力上限。未指定は DEFAULT_MAX_TOKENS（8192）。長い成果物を返すjob（SUGGEST）だけ広げる。 */
  maxTokens?: number;
}

/**
 * 実 @anthropic-ai/sdk と `AnthropicTextGen` の配線（server-only境界）。
 * 既定はモデル名・APIキーとも環境設定値（§5.1）。`apiKey`/`model` を渡すと上書きでき、
 * BYOK（ユーザー復号キー）解決で使う。会話状態はAnthropic Messages APIでは既定でstateless
 * のため無効化操作は不要。SDKの正確な引数名・戻り値は公式型が正。実行時にversion要再確認。
 */
export function createAnthropicTextGen(
  opts: AnthropicClientOptions = {},
): AnthropicTextGen {
  const apiKey = opts.apiKey ?? env.ANTHROPIC_API_KEY;
  const model = opts.model ?? env.ANTHROPIC_TEXT_MODEL;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!model) throw new Error("ANTHROPIC_TEXT_MODEL is not configured");

  const client = new Anthropic({ apiKey });
  const createMessage: RawCreateMessage = async (params, opts) => {
    const res = await client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      { timeout: opts.timeoutMs },
    );
    return res as unknown as RawMessageResponse;
  };

  return new AnthropicTextGen({ createMessage, model, deadline: opts.deadline, maxTokens: opts.maxTokens });
}

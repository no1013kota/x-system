import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { Deadline } from "../jobs/deadline";
import { env } from "../env";
import {
  AnthropicTextGen,
  type RawCreateMessage,
  type RawMessageResponse,
} from "./anthropic";

/**
 * 実 @anthropic-ai/sdk と `AnthropicTextGen` の配線（server-only境界）。
 * モデル名・APIキーは環境設定値（§5.1）。会話状態はAnthropic Messages APIでは
 * 既定でstatelessのため無効化操作は不要（§5.1「プロバイダー側の会話状態は使用しない」）。
 * SDKの正確な引数名・戻り値は公式型が正。実行時にはSDK versionと対応機能を要再確認。
 */
export function createAnthropicTextGen(deadline?: Deadline): AnthropicTextGen {
  const apiKey = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_TEXT_MODEL;
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

  return new AnthropicTextGen({ createMessage, model, deadline });
}

import "server-only";

import OpenAI from "openai";

import { env } from "../env";
import {
  OpenAITextGen,
  type RawOpenAIResponse,
  type RawResponsesCreate,
} from "./openai";

export interface OpenAIClientOptions {
  /** BYOK時はユーザー復号キー。未指定なら運営（env）キー。 */
  apiKey?: string;
  /** 未指定なら env のテキストモデル。 */
  model?: string;
}

/**
 * 実 openai SDK と `OpenAITextGen` の配線（server-only境界, §5.3）。
 * Responses APIを `store:false` で使う。既定はmodel/keyとも環境設定値。`apiKey`/`model`
 * を渡すとBYOK上書き。SDKの正確な引数名・戻り値は公式型が正。実行時にversion要再確認。
 */
export function createOpenAITextGen(
  opts: OpenAIClientOptions = {},
): OpenAITextGen {
  const apiKey = opts.apiKey ?? env.OPENAI_API_KEY;
  const model = opts.model ?? env.OPENAI_TEXT_MODEL;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!model) throw new Error("OPENAI_TEXT_MODEL is not configured");

  const client = new OpenAI({ apiKey });
  const create: RawResponsesCreate = async (params, opts) => {
    const res = await client.responses.create(
      params as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming,
      { timeout: opts.timeoutMs },
    );
    return res as unknown as RawOpenAIResponse;
  };

  return new OpenAITextGen({ create, model });
}

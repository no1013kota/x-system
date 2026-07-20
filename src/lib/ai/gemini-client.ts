import "server-only";

import { GoogleGenAI } from "@google/genai";

import { env } from "../env";
import {
  GeminiTextGen,
  type RawGeminiCall,
  type RawGeminiResponse,
} from "./gemini";

export interface GeminiClientOptions {
  /** BYOK時はユーザー復号キー。未指定なら運営（env）キー。 */
  apiKey?: string;
  /** 未指定なら env のテキストモデル。 */
  model?: string;
}

/**
 * 実 @google/genai SDK と `GeminiTextGen` の配線（server-only境界, §5.4）。
 * M0では `generateContent`（stateless）を配線する。Interactions APIの配線は対応確認後に
 * `interactions` として追加する。既定はmodel/keyとも環境設定値。`apiKey`/`model`でBYOK上書き。
 */
export function createGeminiTextGen(
  opts: GeminiClientOptions = {},
): GeminiTextGen {
  const apiKey = opts.apiKey ?? env.GEMINI_API_KEY;
  const model = opts.model ?? env.GEMINI_TEXT_MODEL;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (!model) throw new Error("GEMINI_TEXT_MODEL is not configured");

  const ai = new GoogleGenAI({ apiKey });
  const generateContent: RawGeminiCall = async (params, opts) => {
    const res = await ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: { ...params.config, httpOptions: { timeout: opts.timeoutMs } },
    });
    return res as unknown as RawGeminiResponse;
  };

  return new GeminiTextGen({ generateContent, model });
}

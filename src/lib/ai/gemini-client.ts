import "server-only";

import { GoogleGenAI } from "@google/genai";

import { env } from "../env";
import {
  GeminiTextGen,
  type RawGeminiCall,
  type RawGeminiResponse,
} from "./gemini";

/**
 * 実 @google/genai SDK と `GeminiTextGen` の配線（server-only境界, §5.4）。
 * M0では `generateContent`（stateless）を配線する。Interactions APIの配線は対応確認後に
 * `interactions` として追加する。model/keyは環境設定値。SDKの正確な引数名は公式型が正。
 */
export function createGeminiTextGen(): GeminiTextGen {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.GEMINI_TEXT_MODEL;
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

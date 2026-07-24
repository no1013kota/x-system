import "server-only";

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

import {
  makeImageGen,
  type ImageGen,
  type RawGeminiImageCreate,
  type RawGeminiImageResponse,
  type RawOpenAIImageCreate,
  type RawOpenAIImageResponse,
} from "./image";
import type { ResolvedKey } from "./resolve-provider";

/**
 * 画像アダプタの server-only 配線（プロンプト設計書 §5.5）。実 SDK（openai / @google/genai）を
 * `image.ts` の純粋アダプタへ注入する。model は resolveImageProvider が解決した env 値
 * （OPENAI_IMAGE_MODEL / GEMINI_IMAGE_MODEL）。SDK の正確な引数・戻り値は公式型が正で、
 * 実行時に version 再確認する（size 文字列・response 形状は変更されうる）。
 */

export function createOpenAIImageGen(opts: { apiKey: string; model: string }): ImageGen {
  const client = new OpenAI({ apiKey: opts.apiKey });
  const create: RawOpenAIImageCreate = async (params, o) => {
    const res = await client.images.generate(
      {
        model: params.model,
        prompt: params.prompt,
        size: params.size,
        n: params.n,
      } as unknown as OpenAI.Images.ImageGenerateParamsNonStreaming,
      { timeout: o.timeoutMs },
    );
    return res as unknown as RawOpenAIImageResponse;
  };
  return makeImageGen({ provider: "openai", model: opts.model, openai: create });
}

export function createGeminiImageGen(opts: { apiKey: string; model: string }): ImageGen {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const create: RawGeminiImageCreate = async (params, o) => {
    const res = await ai.models.generateImages({
      model: params.model,
      prompt: params.prompt,
      config: {
        numberOfImages: params.config.numberOfImages,
        aspectRatio: params.config.aspectRatio,
        httpOptions: { timeout: o.timeoutMs },
      },
    });
    return res as unknown as RawGeminiImageResponse;
  };
  return makeImageGen({ provider: "google", model: opts.model, gemini: create });
}

/** resolveImageProvider が返した ResolvedKey から実 ImageGen を組む。 */
export function resolveImageGen(key: ResolvedKey): ImageGen {
  switch (key.provider) {
    case "openai":
      return createOpenAIImageGen({ apiKey: key.apiKey, model: key.model });
    case "google":
      return createGeminiImageGen({ apiKey: key.apiKey, model: key.model });
    default:
      throw new Error(`unsupported image provider: ${key.provider}`);
  }
}

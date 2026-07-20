import { describe, expect, it, vi } from "vitest";

import {
  GeminiTextGen,
  buildGeminiParams,
  extractGeminiCitations,
  type RawGeminiCall,
  type RawGeminiResponse,
} from "./gemini";
import type { TextGenRequest } from "./types";

const baseReq: TextGenRequest = {
  system: ["SYS", "base_md"],
  user: "入力",
  timeoutMs: 90_000,
};

const grounded: RawGeminiResponse = {
  responseId: "gem_1",
  text: "回答",
  candidates: [
    {
      finishReason: "STOP",
      groundingMetadata: {
        webSearchQueries: ["q1"],
        groundingChunks: [
          { web: { uri: "https://a.test", title: "A" } },
          { web: { uri: "https://a.test", title: "dup" } },
          { web: { uri: "https://b.test" } },
        ],
      },
    },
  ],
  usageMetadata: {
    promptTokenCount: 30,
    candidatesTokenCount: 8,
    cachedContentTokenCount: 12,
  },
};

describe("buildGeminiParams", () => {
  it("puts SYS+base_md in systemInstruction and user in contents", () => {
    const p = buildGeminiParams(baseReq, "gemini-x");
    expect(p.config.systemInstruction).toBe("SYS\n\nbase_md");
    expect(p.contents).toEqual([{ role: "user", parts: [{ text: "入力" }] }]);
  });

  it("adds googleSearch tool for webSearch, responseJsonSchema otherwise", () => {
    expect(
      buildGeminiParams({ ...baseReq, webSearch: { maxUses: 2 } }, "g").config.tools,
    ).toEqual([{ googleSearch: {} }]);
    const schema = { type: "object" };
    const cfg = buildGeminiParams({ ...baseReq, jsonSchema: schema }, "g").config;
    expect(cfg.responseMimeType).toBe("application/json");
    expect(cfg.responseJsonSchema).toEqual(schema);
  });
});

describe("extractGeminiCitations", () => {
  it("reads groundingChunks[].web and dedups by uri", () => {
    expect(extractGeminiCitations(grounded)).toEqual([
      { url: "https://a.test", title: "A" },
      { url: "https://b.test" },
    ]);
  });
});

describe("GeminiTextGen.generate", () => {
  it("normalizes grounding metadata, usage, response id", async () => {
    const generateContent: RawGeminiCall = vi.fn(async () => grounded);
    const out = await new GeminiTextGen({ generateContent, model: "g" }).generate({
      ...baseReq,
      webSearch: { maxUses: 2 },
    });
    expect(out.provider).toBe("google");
    expect(out.requestId).toBe("gem_1");
    expect(out.text).toBe("回答");
    expect(out.citations).toEqual([
      { url: "https://a.test", title: "A" },
      { url: "https://b.test" },
    ]);
    expect(out.stopReason).toBe("STOP");
    expect(out.usage).toMatchObject({
      inputTokens: 30,
      outputTokens: 8,
      cacheReadInputTokens: 12,
      webSearchRequests: 1,
      providerCalls: 1,
    });
  });

  it("routes to interactions when useInteractions=true, else generateContent (fallback toggle)", async () => {
    const generateContent: RawGeminiCall = vi.fn(async () => grounded);
    const interactions: RawGeminiCall = vi.fn(async () => grounded);

    await new GeminiTextGen({
      generateContent,
      interactions,
      useInteractions: true,
      model: "g",
    }).generate(baseReq);
    expect(interactions).toHaveBeenCalledTimes(1);
    expect(generateContent).not.toHaveBeenCalled();

    const gc2: RawGeminiCall = vi.fn(async () => grounded);
    const int2: RawGeminiCall = vi.fn(async () => grounded);
    await new GeminiTextGen({
      generateContent: gc2,
      interactions: int2,
      useInteractions: false,
      model: "g",
    }).generate(baseReq);
    expect(gc2).toHaveBeenCalledTimes(1);
    expect(int2).not.toHaveBeenCalled();
  });
});

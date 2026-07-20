import { describe, expect, it, vi } from "vitest";

import {
  OpenAITextGen,
  buildOpenAIParams,
  type RawOpenAIResponse,
  type RawResponsesCreate,
} from "./openai";
import type { TextGenRequest } from "./types";

const baseReq: TextGenRequest = {
  system: ["SYS-GEN", "base_md"],
  user: "ユーザ入力",
  timeoutMs: 90_000,
};

describe("buildOpenAIParams", () => {
  it("uses store:false, instructions=SYS+base_md, user in input", () => {
    const p = buildOpenAIParams(baseReq, "gpt-x");
    expect(p.store).toBe(false);
    expect(p.instructions).toBe("SYS-GEN\n\nbase_md");
    expect(p.input).toEqual([{ role: "user", content: "ユーザ入力" }]);
  });

  it("adds the web_search tool when webSearch is set (no text format)", () => {
    const p = buildOpenAIParams({ ...baseReq, webSearch: { maxUses: 3 } }, "gpt-x");
    expect(p.tools).toEqual([{ type: "web_search" }]);
    expect(p.text).toBeUndefined();
  });

  it("uses text.format json_schema when no web search", () => {
    const schema = { type: "object" };
    const p = buildOpenAIParams({ ...baseReq, jsonSchema: schema }, "gpt-x");
    expect(p.text).toEqual({
      format: { type: "json_schema", name: "output", schema },
    });
    expect(p.tools).toBeUndefined();
  });
});

describe("OpenAITextGen.generate", () => {
  it("extracts text, citations, web_search count, usage, request id (keeps citations)", async () => {
    const response: RawOpenAIResponse = {
      id: "resp_1",
      status: "completed",
      output: [
        { type: "web_search_call" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "回答本文",
              annotations: [
                { type: "url_citation", url: "https://a.test", title: "A" },
                { type: "url_citation", url: "https://a.test", title: "dup" },
              ],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 50,
        output_tokens: 10,
        input_tokens_details: { cached_tokens: 40 },
      },
    };
    const create: RawResponsesCreate = vi.fn(async () => response);
    const out = await new OpenAITextGen({ create, model: "gpt-x" }).generate({
      ...baseReq,
      webSearch: { maxUses: 3 },
    });

    expect(out.provider).toBe("openai");
    expect(out.requestId).toBe("resp_1");
    expect(out.text).toBe("回答本文");
    expect(out.citations).toEqual([{ url: "https://a.test", title: "A" }]);
    expect(out.stopReason).toBe("completed");
    expect(out.usage).toMatchObject({
      inputTokens: 50,
      outputTokens: 10,
      cacheReadInputTokens: 40,
      webSearchRequests: 1,
      providerCalls: 1,
    });
  });

  it("falls back to output_text when present", async () => {
    const create: RawResponsesCreate = vi.fn(async () => ({
      id: "r",
      output_text: "集約テキスト",
      output: [],
    }));
    const out = await new OpenAITextGen({ create, model: "gpt-x" }).generate(baseReq);
    expect(out.text).toBe("集約テキスト");
  });
});

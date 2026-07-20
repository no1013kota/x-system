import { describe, expect, it, vi } from "vitest";

import { createDeadline } from "../jobs/deadline";
import {
  AnthropicTextGen,
  PauseTurnIncompleteError,
  buildAnthropicParams,
  extractCitations,
  reduceWebSearchMaxUses,
  type RawCreateMessage,
  type RawMessageResponse,
} from "./anthropic";
import type { TextGenRequest } from "./types";

function res(partial: Partial<RawMessageResponse>): RawMessageResponse {
  return { content: [], ...partial };
}

const baseReq: TextGenRequest = {
  system: ["SYS-GEN固定", "base_md固定"],
  user: "可変ユーザ入力",
  timeoutMs: 90_000,
};

describe("reduceWebSearchMaxUses", () => {
  it("halves toward a floor of 1 (§5.2 4→2)", () => {
    expect(reduceWebSearchMaxUses(4)).toBe(2);
    expect(reduceWebSearchMaxUses(2)).toBe(1);
    expect(reduceWebSearchMaxUses(1)).toBe(1);
    expect(reduceWebSearchMaxUses(5)).toBe(2);
  });
});

describe("buildAnthropicParams", () => {
  it("keeps system as the fixed blocks verbatim, user in messages, cache on last block", () => {
    const params = buildAnthropicParams(
      baseReq,
      [{ role: "user", content: baseReq.user }],
      { model: "m", webSearchToolType: "web_search_20260209", maxTokens: 100 },
    );
    // no variable leaks into system — it equals the input system[] texts
    expect(params.system.map((b) => b.text)).toEqual([
      "SYS-GEN固定",
      "base_md固定",
    ]);
    // prompt caching applied to the last fixed block only
    expect(params.system[0].cache_control).toBeUndefined();
    expect(params.system[1].cache_control).toEqual({ type: "ephemeral" });
    // variable input lives in messages, not system
    expect(params.messages[0]).toEqual({ role: "user", content: "可変ユーザ入力" });
  });

  it("adds the web_search tool with max_uses when webSearch is set", () => {
    const params = buildAnthropicParams(
      { ...baseReq, webSearch: { maxUses: 4 } },
      [{ role: "user", content: baseReq.user }],
      { model: "m", webSearchToolType: "web_search_20260209", maxTokens: 100 },
    );
    expect(params.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 4 },
    ]);
    expect(params.output_config).toBeUndefined();
  });

  it("uses output_config for jsonSchema when web search is not used", () => {
    const schema = { type: "object" };
    const params = buildAnthropicParams(
      { ...baseReq, jsonSchema: schema },
      [{ role: "user", content: baseReq.user }],
      { model: "m", webSearchToolType: "web_search_20260209", maxTokens: 100 },
    );
    expect(params.output_config).toEqual({
      format: { type: "json_schema", schema },
    });
    expect(params.tools).toBeUndefined();
  });
});

describe("extractCitations", () => {
  it("collects web_search_tool_result URLs and dedups", () => {
    const cites = extractCitations([
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://a.test", title: "A" },
          { type: "web_search_result", url: "https://a.test", title: "A dup" },
          { type: "web_search_result", url: "https://b.test" },
        ],
      },
      { type: "text", text: "hi", citations: [{ url: "https://c.test", title: "C" }] },
    ]);
    expect(cites).toEqual([
      { url: "https://a.test", title: "A" },
      { url: "https://b.test" },
      { url: "https://c.test", title: "C" },
    ]);
  });
});

describe("AnthropicTextGen.generate", () => {
  it("normalizes a completed response to the common format", async () => {
    const createMessage: RawCreateMessage = vi.fn(async () =>
      res({
        id: "msg_1",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "結果テキスト" },
          {
            type: "web_search_tool_result",
            content: [{ type: "web_search_result", url: "https://x.test", title: "X" }],
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 80,
          server_tool_use: { web_search_requests: 1 },
        },
      }),
    );
    const gen = new AnthropicTextGen({ createMessage, model: "m" });
    const out = await gen.generate({ ...baseReq, webSearch: { maxUses: 3 } });

    expect(out.provider).toBe("anthropic");
    expect(out.requestId).toBe("msg_1");
    expect(out.text).toBe("結果テキスト");
    expect(out.citations).toEqual([{ url: "https://x.test", title: "X" }]);
    expect(out.stopReason).toBe("end_turn");
    expect(out.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 80,
      webSearchRequests: 1,
      providerCalls: 1,
    });
  });

  it("continues pause_turn within the same generate (max 2) and accumulates", async () => {
    const responses = [
      res({ stop_reason: "pause_turn", content: [{ type: "text", text: "a" }] }),
      res({ stop_reason: "pause_turn", content: [{ type: "text", text: "b" }] }),
      res({ id: "final", stop_reason: "end_turn", content: [{ type: "text", text: "c" }] }),
    ];
    let i = 0;
    const createMessage: RawCreateMessage = vi.fn(async () => responses[i++]);
    const gen = new AnthropicTextGen({
      createMessage,
      model: "m",
      deadline: createDeadline(180_000, () => 0), // plenty of time
    });
    const out = await gen.generate(baseReq);

    expect(createMessage).toHaveBeenCalledTimes(3); // initial + 2 continuations
    expect(out.text).toBe("abc"); // accumulated across the turn
    expect(out.stopReason).toBe("end_turn");
    expect(out.requestId).toBe("final");
    // the resume calls carry the prior assistant turn, no extra user message
    const lastParams = (createMessage as ReturnType<typeof vi.fn>).mock.calls[2][0];
    expect(lastParams.messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
  });

  it("throws retryable PauseTurnIncompleteError when continuations exhaust", async () => {
    const createMessage: RawCreateMessage = vi.fn(async () =>
      res({ stop_reason: "pause_turn", content: [{ type: "text", text: "x" }] }),
    );
    const gen = new AnthropicTextGen({
      createMessage,
      model: "m",
      deadline: createDeadline(180_000, () => 0),
    });
    await expect(gen.generate(baseReq)).rejects.toBeInstanceOf(
      PauseTurnIncompleteError,
    );
    // initial + 2 continuations, then the 3rd pause_turn is not continued
    expect(createMessage).toHaveBeenCalledTimes(3);
  });

  it("throws retryable when deadline has <30s left before a continuation", async () => {
    let now = 0;
    const createMessage: RawCreateMessage = vi.fn(async () =>
      res({ stop_reason: "pause_turn", content: [{ type: "text", text: "x" }] }),
    );
    const gen = new AnthropicTextGen({
      createMessage,
      model: "m",
      // 180s budget; advance clock to leave only 20s before the continuation check
      deadline: createDeadline(180_000, () => now),
    });
    now = 165_000; // 15s remaining (<30s headroom)
    await expect(gen.generate(baseReq)).rejects.toBeInstanceOf(
      PauseTurnIncompleteError,
    );
    expect(createMessage).toHaveBeenCalledTimes(1); // first call only, no continuation
  });
});

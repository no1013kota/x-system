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
  it("systemは固定ブロックのまま・可変はmessagesへ・キャッシュは付けない", () => {
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
    /*
      **キャッシュは付けない**（T-M8-335・運営者の判断 2026-08-27）。
      当たるのは「同じ入力を5分以内に再送したとき」だけで、先頭ブロックに
      アカウント.mdが入るため利用者をまたいで共有されない。当たらないキャッシュは
      書き込み料（入力の1.25倍）を捨てているだけなので切った。
      `system` に可変値を入れない作りは残してあるので、戻すのは1行で済む。
    */
    expect(params.system.every((b) => b.cache_control === undefined)).toBe(true);
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
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 4,
        allowed_callers: ["direct"],
      },
    ]);
    expect(params.output_config).toBeUndefined();
  });

  it("always declares allowed_callers=direct so Haiku系 でも 400 にならない", () => {
    // 省略すると `web_search_20260209` は programmatic tool calling を要求する既定になり、
    // 非対応モデル（claude-haiku-4-5 等）が invalid_request_error を返す（2026-07-27の不具合）。
    for (const maxUses of [1, 2, 3, 4]) {
      const params = buildAnthropicParams(
        { ...baseReq, webSearch: { maxUses } },
        [{ role: "user", content: baseReq.user }],
        { model: "claude-haiku-4-5", webSearchToolType: "web_search_20260209", maxTokens: 100 },
      );
      expect(params.tools?.[0]?.allowed_callers).toEqual(["direct"]);
    }
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

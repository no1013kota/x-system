import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  InvalidProviderOutputError,
  runTextGeneration,
  withRepairInstruction,
} from "./pipeline";
import { generationUsageSchema } from "./usage-schema";
import { emptyUsage, type TextGen, type TextGenRequest, type TextGenResult } from "./types";

const schema = z.object({ posts: z.array(z.object({ text: z.string() })) });

const req: TextGenRequest = {
  system: ["SYS", "base_md"],
  user: "生成して",
  timeoutMs: 90_000,
};

/** returns a provider whose generate() yields the given texts in order. */
function providerReturning(...texts: string[]): { provider: TextGen; generate: ReturnType<typeof vi.fn> } {
  let i = 0;
  const generate = vi.fn(
    async (): Promise<TextGenResult> => ({
      provider: "anthropic",
      requestId: `req_${i}`,
      text: texts[Math.min(i++, texts.length - 1)],
      citations: [],
      usage: { ...emptyUsage(), inputTokens: 10, outputTokens: 5, providerCalls: 1 },
      stopReason: "end_turn",
    }),
  );
  return { provider: { generate }, generate };
}

const clock = () => {
  let t = 0;
  return () => (t += 100);
};

describe("runTextGeneration", () => {
  it("does not repair when the first response is valid JSON", async () => {
    const { provider, generate } = providerReturning('{"posts":[{"text":"ok"}]}');
    const out = await runTextGeneration({
      provider,
      request: req,
      schema,
      model: "m",
      operation: "generate",
      now: clock(),
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.parsed.posts[0].text).toBe("ok");
    expect(out.usage.calls).toHaveLength(1);
    expect(generationUsageSchema.safeParse(out.usage).success).toBe(true);
    // 推定原価が計上され、totalがcall合計と一致する（T-M3-03）
    expect(out.usage.calls[0].estimated_cost_usd).toBeCloseTo(0.000105, 6); // (10*3+5*15)/1e6
    expect(out.usage.estimated_cost_usd_total).toBe(out.usage.calls[0].estimated_cost_usd);
  });

  it("accepts code-fenced JSON without a repair call", async () => {
    const { provider, generate } = providerReturning(
      '```json\n{"posts":[{"text":"ok"}]}\n```',
    );
    const out = await runTextGeneration({
      provider,
      request: req,
      schema,
      model: "m",
      operation: "generate",
      now: clock(),
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(out.parsed.posts[0].text).toBe("ok");
  });

  it("runs exactly one repair call when the first response is invalid, then succeeds", async () => {
    const { provider, generate } = providerReturning(
      "not json",
      '{"posts":[{"text":"fixed"}]}',
    );
    const out = await runTextGeneration({
      provider,
      request: req,
      schema,
      model: "m",
      operation: "generate",
      now: clock(),
    });
    expect(generate).toHaveBeenCalledTimes(2); // initial + one repair only
    // the repair call carried the repair instruction
    expect(generate.mock.calls[1][0].user).toBe(withRepairInstruction(req).user);
    expect(out.parsed.posts[0].text).toBe("fixed");
    expect(out.usage.calls).toHaveLength(2);
    expect(generationUsageSchema.safeParse(out.usage).success).toBe(true);
  });

  it("throws non-retryable InvalidProviderOutputError when repair also fails", async () => {
    const { provider, generate } = providerReturning("bad 1", "bad 2");
    let thrown: unknown;
    try {
      await runTextGeneration({
        provider,
        request: req,
        schema,
        model: "m",
        operation: "generate",
        now: clock(),
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidProviderOutputError);
    const err = thrown as InvalidProviderOutputError;
    expect(err.retryable).toBe(false); // not counted in job attempt / retry
    expect(generate).toHaveBeenCalledTimes(2); // initial + one repair, no more
    // usage still accumulated for both calls and valid against §4.6 schema
    expect(err.usage.calls).toHaveLength(2);
    expect(generationUsageSchema.safeParse(err.usage).success).toBe(true);
  });

  it("invokes the post-validation hooks on success", async () => {
    const { provider } = providerReturning('{"posts":[{"text":"ok"}]}');
    const enforceCharLimit = vi.fn();
    const ngCheck = vi.fn();
    await runTextGeneration({
      provider,
      request: req,
      schema,
      model: "m",
      operation: "generate",
      now: clock(),
      hooks: { enforceCharLimit, ngCheck },
    });
    expect(enforceCharLimit).toHaveBeenCalledTimes(1);
    expect(ngCheck).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";

import type { BatchResult } from "../ai/anthropic-batch";
import { fetchMessageBatchResults } from "../ai/anthropic-batch";
import { hoursSinceSubmit, organizeBatchResults } from "./news-batch";

/**
 * ニュースのBatch実行（T-M8-338）。
 *
 * ここで守るのは1つ: **「該当ニュースが無かった」と「取りに行けなかった」を混ぜない**。
 * 非同期になったぶん失敗の形が増えた（返ってこない・errored・24時間で失効）ので、
 * それぞれが `ok=false` として並ぶことを固定する。混ざると画面には
 * どちらも「0件」としか出ず、運営者が原因を追えない（原則1）。
 */

function result(overrides: Partial<BatchResult> & { custom_id: string }): BatchResult {
  return { type: "succeeded", text: "{}", usage: null, errorCode: null, ...overrides };
}

describe("organizeBatchResults", () => {
  it("成功した分野は本文つきで並ぶ", () => {
    const out = organizeBatchResults(["ai"], [result({ custom_id: "ai", text: '{"items":[]}' })]);
    expect(out).toEqual([
      { category: "ai", ok: true, text: '{"items":[]}', errorCode: null, usage: null },
    ]);
  });

  it("**返ってこなかった分野も失敗として並ぶ**（黙って欠けない）", () => {
    const out = organizeBatchResults(["ai", "web3"], [result({ custom_id: "ai" })]);
    expect(out[1]).toMatchObject({ category: "web3", ok: false, errorCode: "missing_result" });
  });

  it("errored / expired は理由つきで失敗になる", () => {
    const out = organizeBatchResults(
      ["ai", "web3"],
      [
        result({ custom_id: "ai", type: "errored", text: null, errorCode: "overloaded_error" }),
        result({ custom_id: "web3", type: "expired", text: null }),
      ],
    );
    expect(out[0]).toMatchObject({ ok: false, errorCode: "overloaded_error" });
    expect(out[1]).toMatchObject({ ok: false, errorCode: "expired" });
  });

  it("成功でも本文が空なら失敗として扱う（0件と区別する）", () => {
    const out = organizeBatchResults(["ai"], [result({ custom_id: "ai", text: null })]);
    expect(out[0].ok).toBe(false);
  });
});

describe("hoursSinceSubmit", () => {
  it("経過時間を時間で返す（失効の判定に使う）", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    expect(hoursSinceSubmit("2026-08-27T11:00:00Z", now)).toBe(1);
    expect(hoursSinceSubmit("2026-08-26T11:00:00Z", now)).toBe(25);
  });

  it("読めない値は0として扱う（失効扱いで消さない）", () => {
    expect(hoursSinceSubmit("not-a-date", new Date())).toBe(0);
  });
});

/**
 * JSONLの取り込み。**1行壊れていても他の分野は使える**ことを固定する
 * （6分野を1つのバッチで投げるので、1行のために全部捨てると被害が6倍になる）。
 */
describe("fetchMessageBatchResults", () => {
  const original = globalThis.fetch;

  async function withBody<T>(body: string, fn: () => Promise<T>): Promise<T> {
    globalThis.fetch = (async () =>
      new Response(body, { status: 200 })) as unknown as typeof fetch;
    try {
      return await fn();
    } finally {
      globalThis.fetch = original;
    }
  }

  it("テキストブロックを連結し、usageと失敗理由を取り出す", async () => {
    const line = JSON.stringify({
      custom_id: "ai",
      result: {
        type: "succeeded",
        message: {
          content: [
            { type: "text", text: '{"items":' },
            { type: "text", text: "[]}" },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            server_tool_use: { web_search_requests: 3 },
          },
        },
      },
    });
    const out = await withBody(line, () => fetchMessageBatchResults("k", "https://example.test/r"));
    expect(out[0]).toMatchObject({
      custom_id: "ai",
      type: "succeeded",
      text: '{"items":[]}',
      usage: { input_tokens: 100, output_tokens: 20, web_search_requests: 3 },
    });
  });

  it("壊れた行は落として続ける（他の分野を巻き添えにしない）", async () => {
    const good = JSON.stringify({
      custom_id: "web3",
      result: { type: "succeeded", message: { content: [{ type: "text", text: "{}" }] } },
    });
    const out = await withBody(`{壊れている\n${good}\n\n`, () =>
      fetchMessageBatchResults("k", "https://example.test/r"),
    );
    expect(out).toHaveLength(1);
    expect(out[0].custom_id).toBe("web3");
  });
});

import { describe, expect, it } from "vitest";

import { classifyJobError, decideJobOutcome } from "./job-error";
import { MAX_ATTEMPTS } from "./retry";

/**
 * 中央finalizerの失敗分類（要件04 §5・D-5）。retryable(429/5xx/network) だけが差し戻され、
 * 認証・入力エラーと上限到達は確定失敗になることを確認する。
 */

describe("classifyJobError", () => {
  it("明示の kind を優先する（XApiError 等）", () => {
    expect(classifyJobError({ kind: "rate_limit", status: 500 })).toBe("rate_limit");
    expect(classifyJobError({ kind: "auth" })).toBe("auth");
    expect(classifyJobError({ kind: "でたらめ" })).toBe("unknown");
  });

  it("retryable を宣言する例外は server 扱い（PauseTurnIncompleteError）", () => {
    class PauseTurnIncompleteError extends Error {
      readonly retryable = true;
    }
    expect(classifyJobError(new PauseTurnIncompleteError())).toBe("server");
  });

  it("HTTP status から分類する", () => {
    expect(classifyJobError({ status: 429 })).toBe("rate_limit");
    expect(classifyJobError({ status: 500 })).toBe("server");
    expect(classifyJobError({ status: 503 })).toBe("server");
    expect(classifyJobError({ status: 401 })).toBe("auth");
    expect(classifyJobError({ status: 403 })).toBe("auth");
    expect(classifyJobError({ status: 400 })).toBe("invalid");
    expect(classifyJobError({ statusCode: 429 })).toBe("rate_limit");
  });

  it("network系のcodeは cause 側にあっても network", () => {
    expect(classifyJobError({ code: "ECONNRESET" })).toBe("network");
    expect(classifyJobError({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })).toBe("network");
    expect(classifyJobError({ name: "AbortError" })).toBe("network");
  });

  it("判断材料が無ければ unknown（＝再試行しない）", () => {
    expect(classifyJobError(new Error("boom"))).toBe("unknown");
    expect(classifyJobError(null)).toBe("unknown");
    expect(classifyJobError("文字列")).toBe("unknown");
    expect(classifyJobError({ code: "invalid_output" })).toBe("unknown");
  });
});

describe("decideJobOutcome", () => {
  const noJitter = () => 0;

  it("retryable かつ上限未満なら backoff 付きで retry", () => {
    const outcome = decideJobOutcome({ status: 429 }, 1, noJitter);
    expect(outcome).toEqual({ action: "retry", kind: "rate_limit", delayMs: 1000 });
    const second = decideJobOutcome({ status: 500 }, 2, noJitter);
    expect(second).toEqual({ action: "retry", kind: "server", delayMs: 2000 });
  });

  it("上限到達なら確定失敗（自動取得しない）", () => {
    expect(decideJobOutcome({ status: 429 }, MAX_ATTEMPTS, noJitter)).toEqual({
      action: "fail",
      kind: "rate_limit",
    });
  });

  it("auth・invalid・unknown は再試行しない", () => {
    for (const error of [{ status: 401 }, { status: 400 }, new Error("boom")]) {
      expect(decideJobOutcome(error, 1, noJitter).action).toBe("fail");
    }
  });
});

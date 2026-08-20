import { describe, expect, it } from "vitest";

import {
  PROVIDER_FAILURE_GUIDE,
  classifyProviderFailure,
  providerFailureGuide,
  type ProviderFailureKind,
} from "./provider-failure";

/**
 * T-M8-163。**実際に本番へ記録された文言をfixtureにする。**
 * 作った文言で試す分類器は、本物が来たときに当たらない（`prerender-nonce.test.ts` と同じ考え方）。
 */

/** 2026-08-20、本番の `news_fetch_outcomes.provider_raw_error` にそのまま入っていた文字列。 */
const REAL_ANTHROPIC_CREDIT_ERROR =
  'Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CeDZwe5rq2Q3mVUL2xN4X"}';

describe("classifyProviderFailure", () => {
  /**
   * これが当たらなかったために、運営者は `http_400` だけを見せられ
   * 「Claudeに聞いてください」と案内されていた（原則2違反）。
   */
  it("本番で実際に起きたAnthropicのクレジット切れを credit_exhausted に分類する", () => {
    expect(classifyProviderFailure("http_400", REAL_ANTHROPIC_CREDIT_ERROR)).toBe(
      "credit_exhausted",
    );
  });

  it("OpenAIの残高切れの言い方も credit_exhausted に分類する", () => {
    for (const raw of [
      "You exceeded your current quota, please check your plan and billing details.",
      '{"error":{"code":"insufficient_quota"}}',
    ]) {
      expect(classifyProviderFailure("http_429", raw), raw).toBe("credit_exhausted");
    }
  });

  /**
   * **クレジット切れとレート制限は取り違えやすい。** どちらも429で来ることがあり、
   * 「待てば直る」か「お金を払わないと直らない」かで運営者の操作が真逆になる。
   */
  it("レート制限はクレジット切れと区別する", () => {
    expect(
      classifyProviderFailure("http_429", "Rate limit exceeded. Please retry later."),
    ).toBe("rate_limited");
  });

  it("キーの問題は invalid_key に分類する", () => {
    for (const raw of [
      '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      "Incorrect API key provided",
    ]) {
      expect(classifyProviderFailure("http_401", raw), raw).toBe("invalid_key");
    }
  });

  it("モデル名・入力長・提供元障害もそれぞれ分ける", () => {
    expect(
      classifyProviderFailure("http_404", "model: claude-old does not exist"),
    ).toBe("model_not_found");
    expect(
      classifyProviderFailure("http_400", "prompt is too long: 250000 tokens"),
    ).toBe("context_too_long");
    expect(classifyProviderFailure("http_529", "Overloaded")).toBe("provider_outage");
  });

  it("手がかりが無ければ unknown（勝手に決めつけない）", () => {
    expect(classifyProviderFailure(null, null)).toBe("unknown");
    expect(classifyProviderFailure("", "   ")).toBe("unknown");
    expect(classifyProviderFailure("http_400", "something we have never seen")).toBe(
      "unknown",
    );
  });

  /** 本文が無くコードだけでも、分かる範囲は分類する。 */
  it("コードだけでも判定できるものは判定する", () => {
    expect(classifyProviderFailure("http_401", null)).toBe("invalid_key");
    expect(classifyProviderFailure("http_429", null)).toBe("rate_limited");
  });
});

describe("PROVIDER_FAILURE_GUIDE", () => {
  const KINDS: ProviderFailureKind[] = [
    "credit_exhausted",
    "rate_limited",
    "invalid_key",
    "model_not_found",
    "context_too_long",
    "provider_outage",
    "unknown",
  ];

  it("すべての型に日本語の説明と次の一手がある", () => {
    for (const kind of KINDS) {
      const guide = providerFailureGuide(kind);
      expect(guide.label, kind).toBeTruthy();
      expect(guide.nextAction, kind).toBeTruthy();
      // 内部用語・英語コードを運営者へ出さない（要件06 §8）。
      expect(guide.label, kind).not.toMatch(/http_|_error|[a-z]_[a-z]/);
    }
  });

  it("型を足したらguideも足さないと落ちる（片方だけ増えるのを防ぐ）", () => {
    expect(Object.keys(PROVIDER_FAILURE_GUIDE).sort()).toEqual([...KINDS].sort());
  });

  /** クレジット切れは運営者が自分で直せる。その操作を必ず書く。 */
  it("クレジット切れの次の一手に購入する場所が書かれている", () => {
    expect(providerFailureGuide("credit_exhausted").nextAction).toContain("クレジット");
  });
});

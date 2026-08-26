import { describe, expect, it } from "vitest";

import { ALL_ERROR_CODES, AppError, toUserFacingError, userMessageForCode } from "./errors";

describe("toUserFacingError", () => {
  it("maps an AppError to its code and safe message", () => {
    const e = new AppError("usage_limit_exceeded");
    expect(toUserFacingError(e)).toEqual({
      code: "usage_limit_exceeded",
      message: userMessageForCode("usage_limit_exceeded"),
    });
  });

  it("includes author-controlled details when present", () => {
    const e = new AppError("api_key_required", {
      details: { missing: ["anthropic"], settingsPath: "/app/settings" },
    });
    const out = toUserFacingError(e);
    expect(out.code).toBe("api_key_required");
    expect(out.details).toEqual({
      missing: ["anthropic"],
      settingsPath: "/app/settings",
    });
  });

  it("collapses unknown errors to internal_error without leaking detail", () => {
    const raw = new Error("provider said: secret stack trace at line 42");
    const out = toUserFacingError(raw);
    expect(out.code).toBe("internal_error");
    expect(out.message).toBe(userMessageForCode("internal_error"));
    // the raw message / stack must not appear in the user-facing output
    expect(JSON.stringify(out)).not.toContain("secret stack trace");
    expect(out).not.toHaveProperty("details");
  });

  it("does not expose the cause chain to users", () => {
    const e = new AppError("provider_error", {
      cause: new Error("HTTP 500 body: {api_key: sk-xxx}"),
    });
    const out = toUserFacingError(e);
    expect(JSON.stringify(out)).not.toContain("sk-xxx");
  });
});

/**
 * 利用者向け文言の質を固定する（T-M8-329・運営者の指摘 2026-08-27
 * 「エラー内容がユーザー目線でわかりやすいように」）。
 *
 * **「何が起きたか」だけの文言は問い合わせにしかならない**（CLAUDE.md 原則2）。
 * 検出器が空振りしないよう、当たる先を明示して数える。
 */
describe("利用者向けエラー文言（T-M8-329）", () => {
  const messages = ALL_ERROR_CODES.map((code) => [code, userMessageForCode(code)] as const);

  it("全コードに文言がある（コードを足したら文言も足す）", () => {
    for (const [code, text] of messages) {
      expect(text, `${code} の文言が空`).toBeTruthy();
      expect(text.length, `${code} の文言が短すぎる`).toBeGreaterThan(8);
    }
  });

  it("行き詰まる文言を残さない（次にやることが書いてある）", () => {
    // 「〜できません。」だけで終わる文言を落とす。何をすればよいかが無いと打つ手がない。
    const deadEnds = messages.filter(
      ([, t]) =>
        !/(ください|お待ち|お問い合わせ)/.test(t),
    );
    expect(deadEnds.map(([c]) => c), "次の一手が書かれていない文言がある").toEqual([]);
  });

  it("内部の値を混ぜない（上限・ID・providerの生文言）", () => {
    for (const [code, text] of messages) {
      expect(text, `${code} に数値の上限が出ている`).not.toMatch(/\d{3,}/);
      expect(text, `${code} に内部語が出ている`).not.toMatch(/service_role|null|undefined|Error/);
    }
  });
});

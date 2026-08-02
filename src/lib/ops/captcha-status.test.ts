import { describe, expect, it, vi } from "vitest";

import { classifyCaptchaProbe, judgeCaptcha, probeCaptcha } from "./captcha-status";

/**
 * 人間確認が実際に効いているかの確認（T-M7-53）。
 * 2026-08-02、staging が無効のまま「確認欄は出ているのに素通りできる」状態だった。
 */

function response(status: number, body: string) {
  return { status, text: async () => body } as Response;
}

describe("classifyCaptchaProbe", () => {
  it("captcha_failed が返れば有効", () => {
    const result = classifyCaptchaProbe({
      status: 400,
      body: '{"error_code":"captcha_failed","msg":"captcha protection: request disallowed (no captcha_token found)"}',
    });
    expect(result.state).toBe("enabled");
  });

  it("資格情報の判定まで進んでいれば無効", () => {
    expect(
      classifyCaptchaProbe({ status: 400, body: '{"error_code":"invalid_credentials"}' }).state,
    ).toBe("disabled");
    expect(
      classifyCaptchaProbe({ status: 400, body: '{"error":"Invalid login credentials"}' }).state,
    ).toBe("disabled");
  });

  it("判断できない応答は unknown（有効だと決めつけない）", () => {
    for (const body of ["", "{}", '{"error":"rate limit exceeded"}', "<html>502</html>"]) {
      expect(classifyCaptchaProbe({ status: 500, body }).state).toBe("unknown");
    }
  });
});

describe("probeCaptcha", () => {
  it("接続情報が無ければ叩かずに unknown", async () => {
    const fetchImpl = vi.fn();
    const result = await probeCaptcha({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.state).toBe("unknown");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("実在しないアドレスへ、captchaトークンを付けずに送る（副作用を出さない）", async () => {
    const fetchImpl = vi.fn(async () => response(400, '{"error_code":"captcha_failed"}'));
    const result = await probeCaptcha({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe("enabled");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/auth/v1/token?grant_type=password");
    const body = JSON.parse(String(init.body));
    expect(body.email).toContain(".invalid");
    // トークンを付けて送ると「無効」と誤判定する（通ってしまうため）。付けないことが判定の前提。
    expect(body).not.toHaveProperty("gotrue_meta_security");
    expect(body).not.toHaveProperty("captcha_token");
  });

  it("到達できなければ unknown（無効と同一視しない）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await probeCaptcha({
      supabaseUrl: "https://example.supabase.co",
      anonKey: "anon",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.state).toBe("unknown");
    expect(result.detail).toContain("network down");
  });
});

describe("judgeCaptcha", () => {
  it("無効は error にする（注意で済ませない）", () => {
    const check = judgeCaptcha({ state: "disabled", detail: "x" });
    expect(check.level).toBe("error");
    expect(check.nextAction).toContain("Attack Protection");
  });

  it("有効は ok、判定不能は warn", () => {
    expect(judgeCaptcha({ state: "enabled", detail: "x" }).level).toBe("ok");
    expect(judgeCaptcha({ state: "unknown", detail: "確認できませんでした" }).level).toBe("warn");
  });

  it("判定不能のときは理由をそのまま出す", () => {
    expect(judgeCaptcha({ state: "unknown", detail: "接続情報が無い" }).detail).toBe("接続情報が無い");
  });
});

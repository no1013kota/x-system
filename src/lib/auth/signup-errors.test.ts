import { describe, expect, it } from "vitest";

import {
  SIGNUP_GENERIC_ERROR,
  authErrorCode,
  signUpErrorMessage,
} from "./signup-errors";

/**
 * T-M8-127。**ローカルSupabaseで実際に観測した応答**を入力にする（2026-08-18）。
 * 作文した形ではなく、運営者が踏んだ経路そのものを固定する。
 */
describe("authErrorCode", () => {
  it("SDKの `code` を読む", () => {
    expect(authErrorCode({ code: "user_already_exists" })).toBe("user_already_exists");
  });

  it("RESTの `error_code` も読む（経路で名前が違う）", () => {
    expect(authErrorCode({ error_code: "over_email_send_rate_limit", code: 429 })).toBe(
      "over_email_send_rate_limit",
    );
  });

  it("コードが無くても429ならレート制限として扱う", () => {
    expect(authErrorCode({ status: 429, message: "rate limited" })).toBe(
      "over_email_send_rate_limit",
    );
  });

  it("判定できないものは null", () => {
    expect(authErrorCode(null)).toBeNull();
    expect(authErrorCode({})).toBeNull();
    expect(authErrorCode(new Error("boom"))).toBeNull();
  });
});

describe("signUpErrorMessage", () => {
  it("登録済みは「既に登録されています」と言い、ログインへ導く", () => {
    const r = signUpErrorMessage({ code: "user_already_exists", status: 422 });
    expect(r.message).toContain("既に登録されています");
    expect(r.action?.href).toBe("/login");
  });

  it("登録済みで「時間をおいて」と言わない（待っても直らないため）", () => {
    const r = signUpErrorMessage({ code: "user_already_exists" });
    expect(r.message).not.toContain("時間をおいて");
    expect(r.message).not.toContain("入力内容を確認");
  });

  it("レート制限は待てば直ると伝え、入力を直せと言わない", () => {
    const r = signUpErrorMessage({ error_code: "over_email_send_rate_limit", code: 429 });
    expect(r.message).toContain("数分おいて");
    expect(r.message).not.toContain("入力内容を確認");
    expect(r.action).toBeUndefined();
  });

  it("パスワードが弱い・メール形式は、直すべき場所を指す", () => {
    expect(signUpErrorMessage({ code: "weak_password" }).message).toContain("パスワード");
    expect(signUpErrorMessage({ code: "email_address_invalid" }).message).toContain(
      "メールアドレス",
    );
  });

  it("未知のエラーは従来の汎用文へ落とす（勝手に断定しない）", () => {
    expect(signUpErrorMessage({ code: "something_new" })).toEqual(SIGNUP_GENERIC_ERROR);
    expect(signUpErrorMessage(new Error("boom"))).toEqual(SIGNUP_GENERIC_ERROR);
  });
});

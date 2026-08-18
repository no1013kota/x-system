import { describe, expect, it } from "vitest";

import { EMAIL_CODE_LENGTH, isEmailCodeComplete, normalizeEmailCode } from "./email-code";

/**
 * T-M8-121。**利用者が正しく写しているのに弾かれる**形を作らないための整形。
 * メールからのコピーで実際に混ざるもの（空白・全角・改行・ハイフン）を入力にする。
 */
describe("normalizeEmailCode", () => {
  it("数字だけを取り出す", () => {
    expect(normalizeEmailCode("123456")).toBe("123456");
  });

  it("コピーで混ざる空白・改行・記号を落とす", () => {
    expect(normalizeEmailCode(" 123456 ")).toBe("123456");
    expect(normalizeEmailCode("123 456")).toBe("123456");
    expect(normalizeEmailCode("123-456")).toBe("123456");
    expect(normalizeEmailCode("123456\n")).toBe("123456");
  });

  it("全角数字を半角にする（日本語環境のIMEで実際に起きる）", () => {
    expect(normalizeEmailCode("１２３４５６")).toBe("123456");
    expect(normalizeEmailCode("１2３4５6")).toBe("123456");
  });

  it("空・記号だけは空文字になる", () => {
    expect(normalizeEmailCode("")).toBe("");
    expect(normalizeEmailCode("----")).toBe("");
  });
});

describe("isEmailCodeComplete", () => {
  it("6桁そろって初めて true", () => {
    expect(isEmailCodeComplete("12345")).toBe(false);
    expect(isEmailCodeComplete("123456")).toBe(true);
    expect(isEmailCodeComplete("１２３４５６")).toBe(true);
    expect(isEmailCodeComplete(" 12 34 56 ")).toBe(true);
  });

  it("7桁以上は false（貼り付けミスをそのまま送らない）", () => {
    expect(isEmailCodeComplete("1234567")).toBe(false);
  });

  it("桁数は定数から決まる", () => {
    expect(isEmailCodeComplete("9".repeat(EMAIL_CODE_LENGTH))).toBe(true);
  });
});

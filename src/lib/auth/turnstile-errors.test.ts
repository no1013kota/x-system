import { describe, expect, it } from "vitest";

import { classifyTurnstileError, isTurnstileSettingError } from "./turnstile-errors";

describe("classifyTurnstileError", () => {
  it("ドメイン未許可（110200）は設定の問題として扱い、再試行を促さない", () => {
    const failure = classifyTurnstileError("110200");
    expect(failure.kind).toBe("setting");
    expect(failure.message).not.toContain("もう一度");
    expect(failure.message).toContain("110200");
    expect(failure.operatorHint).toContain("Hostname Management");
  });

  it.each(["110100", "110110", "400020", "400070"])(
    "サイトキー由来のコード %s も設定の問題になる",
    (code) => {
      const failure = classifyTurnstileError(code);
      expect(failure.kind).toBe("setting");
      expect(failure.operatorHint).toBeTruthy();
    },
  );

  it.each([
    ["200100", "時刻"],
    ["200500", "challenges.cloudflare.com"],
  ])("利用者の環境が原因のコード %s は利用者向けの案内を出す", (code, expected) => {
    const failure = classifyTurnstileError(code);
    expect(failure.kind).toBe("visitor_environment");
    expect(failure.message).toContain(expected);
    // 設定の直し方は利用者に見せない。
    expect(failure.operatorHint).toBeUndefined();
  });

  it.each(["110600", "110620", "300010", "600010"])(
    "一時的な失敗 %s は再試行を促す",
    (code) => {
      const failure = classifyTurnstileError(code);
      expect(failure.kind).toBe("transient");
      expect(failure.message).toContain("もう一度");
      expect(failure.message).toContain(code);
    },
  );

  it("未知のコードは transient に寄せる（設定の問題だと断定しない）", () => {
    const failure = classifyTurnstileError("999999");
    expect(failure.kind).toBe("transient");
    expect(failure.message).toContain("999999");
  });

  it("コードが無い・型が違う場合も文言が壊れない", () => {
    for (const raw of [undefined, null, {}, ""]) {
      const failure = classifyTurnstileError(raw);
      expect(failure.kind).toBe("transient");
      expect(failure.code).toBe("");
      // 「（コード ）」のような空括弧を出さない。
      expect(failure.message).not.toContain("（コード");
      expect(failure.message).toContain("もう一度");
    }
  });

  it("数値で渡ってきたコードも文字列として扱う", () => {
    expect(classifyTurnstileError(110200).kind).toBe("setting");
  });

  it("isTurnstileSettingError は設定の問題だけ true", () => {
    expect(isTurnstileSettingError("110200")).toBe(true);
    expect(isTurnstileSettingError("300010")).toBe(false);
    expect(isTurnstileSettingError(undefined)).toBe(false);
  });
});

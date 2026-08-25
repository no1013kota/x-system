import { describe, expect, it } from "vitest";

import { isLiveChargesDisabled } from "./stripe-errors";

/**
 * T-M8-148。**「待っても直らない失敗」を「時間をおいて再度」と言わないための判定。**
 * 2026-08-18に本番で出た実際の応答を固定する。
 */
describe("isLiveChargesDisabled", () => {
  it("本番で実際に返ってきた文言を検出する", () => {
    const actual = {
      type: "StripeInvalidRequestError",
      raw: { message: "Your account cannot currently make live charges." },
    };
    expect(isLiveChargesDisabled(actual)).toBe(true);
  });

  it("message 側に入っている実装でも検出する", () => {
    expect(
      isLiveChargesDisabled(new Error("Your account cannot currently make live charges.")),
    ).toBe(true);
  });

  it("大文字小文字は問わない", () => {
    expect(isLiveChargesDisabled({ message: "ACCOUNT CANNOT MAKE LIVE CHARGES" })).toBe(true);
  });

  it("一時的な障害や他の失敗は対象にしない（逆の嘘をつかない）", () => {
    expect(isLiveChargesDisabled(new Error("Request timed out"))).toBe(false);
    expect(isLiveChargesDisabled({ raw: { message: "No such price: price_x" } })).toBe(false);
    expect(isLiveChargesDisabled(null)).toBe(false);
    expect(isLiveChargesDisabled("live charges")).toBe(false);
  });
});

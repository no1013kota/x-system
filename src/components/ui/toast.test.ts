import { describe, expect, it } from "vitest";

import { toastRole, toastShouldAutoDismiss, AUTO_DISMISS_MS } from "./toast-policy";

/**
 * トーストの振る舞い（T-M8-15）。**成功と失敗で扱いを変える**ことを固定する。
 *
 * DOMを描かずに検証できるよう、判断だけを `toast-policy.ts` の純関数へ出してある
 * （このリポジトリの単体テストは `environment: node` で、DOMを持たない）。
 */
describe("トーストの読み上げ種別", () => {
  it("成功は status（割り込まない）", () => {
    expect(toastRole("success")).toBe("status");
  });

  it("失敗は alert（割り込んで伝える）", () => {
    expect(toastRole("error")).toBe("alert");
  });
});

describe("自動で消えるかどうか", () => {
  it("成功は自動で消える", () => {
    expect(toastShouldAutoDismiss("success")).toBe(true);
  });

  it("**失敗は自動で消さない**（見逃させないため）", () => {
    expect(toastShouldAutoDismiss("error")).toBe(false);
  });

  it("自動で消えるまでの時間はデザインどおり5秒", () => {
    expect(AUTO_DISMISS_MS).toBe(5000);
  });
});

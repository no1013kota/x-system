import { describe, expect, it } from "vitest";

import { CURRENT_AUTOMATION_CONSENT_VERSION, consentVersionLabel } from "./legal";

/**
 * 同意versionの利用者向け表記（要件06 §3.5）。内部値をそのまま見せないことを担保する。
 */
describe("consentVersionLabel", () => {
  it("日付部分を日本語表記へ変換する", () => {
    expect(consentVersionLabel("2026-07-22")).toBe("2026年7月22日版");
  });

  it("リリース前の -draft 等の接尾辞を利用者に見せない", () => {
    expect(consentVersionLabel("2026-07-22-draft")).toBe("2026年7月22日版");
    expect(consentVersionLabel(CURRENT_AUTOMATION_CONSENT_VERSION)).not.toContain("draft");
  });

  it("日付として解釈できない値はそのまま返す", () => {
    expect(consentVersionLabel("v1")).toBe("v1");
  });
});

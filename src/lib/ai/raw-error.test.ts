import { describe, expect, it } from "vitest";

import { InvalidProviderOutputError, providerRawOutputOf } from "./pipeline";
import {
  formatFailureRawError,
  formatProviderAttempts,
  RAW_ERROR_MAX,
  summarizeError,
  truncateRawError,
} from "./raw-error";

/**
 * 失敗の原因を残す生文面（F4）。
 *
 * T-M7-39 で `provider_raw_error` を入れたのに、**最も多い失敗である検証失敗では空**だった。
 * 運営者が「AIが何を返して落ちたのか」を辿れる状態を守る（CLAUDE.md 原則2）。
 */

describe("truncateRawError", () => {
  it("空・空白だけなら null（意味の無い値を保存しない）", () => {
    expect(truncateRawError("")).toBeNull();
    expect(truncateRawError("   \n ")).toBeNull();
    expect(truncateRawError(null)).toBeNull();
    expect(truncateRawError(undefined)).toBeNull();
  });

  it("上限を超えたら末尾を … にして切る", () => {
    const out = truncateRawError("あ".repeat(RAW_ERROR_MAX + 10));
    expect(out).toHaveLength(RAW_ERROR_MAX + 1);
    expect(out?.endsWith("…")).toBe(true);
  });

  it("上限以内はそのまま（前後の空白だけ落とす）", () => {
    expect(truncateRawError("  hello  ")).toBe("hello");
  });
});

describe("summarizeError", () => {
  it("name と message、あれば cause も出す", () => {
    const e = new Error("boom", { cause: "inner" });
    expect(summarizeError(e)).toBe("Error: boom / cause: inner");
  });

  it("Error でない値も文字列にする", () => {
    expect(summarizeError("just a string")).toBe("just a string");
  });
});

describe("formatProviderAttempts", () => {
  it("試行ごとにラベルを付ける（修復callが分かるようにする）", () => {
    expect(formatProviderAttempts(['{"a":1}', '{"items":[]}'])).toBe(
      '1回目の応答: {"a":1}\n2回目の応答（修復指示つき）: {"items":[]}',
    );
  });

  it("3回目以降も番号で出す", () => {
    expect(formatProviderAttempts(["a", "b", "c"])).toContain("3回目の応答: c");
  });

  /**
   * 空の応答も残す。**何も返ってこなかったこと自体が原因の手がかり**で
   * （providerの問題であってスキーマの問題ではない）、行を消すと
   * 「そのcallが無かった」と読めてしまう。番号は試行の実際の順番を指す。
   */
  it("空の応答は「（空）」として残る（行が消えない・番号がずれない）", () => {
    expect(formatProviderAttempts(["", "  ", "x"])).toBe(
      "1回目の応答: （空）\n2回目の応答（修復指示つき）: （空）\n3回目の応答: x",
    );
  });

  it("試行そのものが無ければ null", () => {
    expect(formatProviderAttempts([])).toBeNull();
  });

  /**
   * **両方の試行を残す**。2026-07-27 の事例では初回が妥当なJSONで長さ超過、修復callは
   * `{"items":[]}` と中身が違い、片方だけでは原因が特定できなかった。
   */
  it("長い応答が2つあっても両方が残る（片方が丸ごと消えない）", () => {
    const out = formatProviderAttempts(["あ".repeat(5000), "い".repeat(5000)]) ?? "";
    expect(out).toContain("1回目の応答");
    expect(out).toContain("2回目の応答（修復指示つき）");
    expect(out.length).toBeLessThanOrEqual(RAW_ERROR_MAX + 1);
  });
});

describe("formatFailureRawError", () => {
  it("例外の要約と応答本文をつなぐ", () => {
    expect(formatFailureRawError(new Error("bad json"), "1回目の応答: {")).toBe(
      "Error: bad json\n1回目の応答: {",
    );
  });

  it("応答本文が無ければ要約だけ（X APIの失敗などはこちら）", () => {
    expect(formatFailureRawError(new Error("x api 403: forbidden"), null)).toBe(
      "Error: x api 403: forbidden",
    );
  });
});

describe("providerRawOutputOf", () => {
  it("InvalidProviderOutputError から本文を取り出せる", () => {
    const e = new InvalidProviderOutputError({ calls: [], estimated_cost_usd_total: 0 }, "raw body");
    expect(providerRawOutputOf(e)).toBe("raw body");
  });

  it("他の例外は null（載せていないものを推測しない）", () => {
    expect(providerRawOutputOf(new Error("other"))).toBeNull();
    expect(providerRawOutputOf("string")).toBeNull();
  });

  /**
   * 本文は **private field** で持つ（F4）。public プロパティだと
   * `console.error(error)` と `JSON.stringify` でログへ出て要件01 §8 に反する。
   */
  it("本文はログへ出ない（JSON.stringify・message に現れない）", () => {
    const secret = "SECRET_PROVIDER_BODY";
    const e = new InvalidProviderOutputError({ calls: [], estimated_cost_usd_total: 0 }, secret);
    expect(JSON.stringify(e)).not.toContain(secret);
    expect(e.message).not.toContain(secret);
    expect(String(e)).not.toContain(secret);
    // 取り出したいときは明示的に読む。
    expect(e.rawOutput).toBe(secret);
  });
});

import { describe, expect, it } from "vitest";

import { formatJst, toIso, toIsoOrNull, yen } from "./format";

/**
 * 画面の日時・金額の表記（T-M8-292）。
 *
 * `Intl` の実体をモジュールスコープで使い回すようにしたので、**表記が変わっていないこと**を
 * ここで固定する。共有した実体が壊れると、下書き・履歴・ニュース・分析・通知の
 * すべての行が同時に狂う——それでいて例外は出ないので、テストが無いと気付けない。
 */
describe("formatJst", () => {
  it("JSTの日付＋時刻で出す（UTCとの差で日付がまたぐ場合も）", () => {
    // 2026-08-25T00:30:00Z = JST 8/25 09:30
    expect(formatJst("2026-08-25T00:30:00Z")).toBe("2026/08/25 9:30");
    // 2026-08-24T15:30:00Z = JST 8/25 00:30（UTCでは前日）
    expect(formatJst("2026-08-24T15:30:00Z")).toBe("2026/08/25 0:30");
  });

  it("何度呼んでも同じ結果（実体を使い回しても状態を持たない）", () => {
    const iso = "2026-01-02T03:04:05Z";
    const once = formatJst(iso);
    for (let i = 0; i < 100; i++) expect(formatJst(iso)).toBe(once);
  });
});

describe("yen", () => {
  it("3桁区切りにする（記号は呼び出し側が付ける）", () => {
    expect(yen(0)).toBe("0");
    expect(yen(980)).toBe("980");
    expect(yen(14800)).toBe("14,800");
    expect(yen(1234567)).toBe("1,234,567");
  });

  it("負の値も区切る（返金の表示で使う）", () => {
    expect(yen(-3980)).toBe("-3,980");
  });
});

describe("toIso / toIsoOrNull", () => {
  it("Date も文字列も同じ正準表記へ揃える", () => {
    const iso = "2026-08-25T00:30:00.000Z";
    expect(toIso(new Date(iso))).toBe(iso);
    expect(toIso("2026-08-25T00:30:00Z")).toBe(iso);
  });

  it("null/undefined は null のまま（存在しない日付を作らない）", () => {
    expect(toIsoOrNull(null)).toBeNull();
  });
});

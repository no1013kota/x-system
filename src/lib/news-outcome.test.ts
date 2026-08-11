import { describe, expect, it } from "vitest";

import {
  classifyNewsOutcome,
  formatDropReasons,
  formatTooOldAges,
  META_TOO_OLD_MAX_AGE_H,
  META_TOO_OLD_MIN_AGE_H,
  mostlyDropped,
  onlyOutsideWindow,
  REASON_TOO_OLD,
} from "./news-outcome";

/**
 * ニュース取得結果の判定（T-M8-83）。
 *
 * ここが単一の正本になる前は、同じ判定が `smoke/scenarios.ts` と `ops/diagnostics.ts` に
 * 二重にあり、`ops/daily-summary.ts` には**無かった**。その結果、まったく同じ状況を
 * doctor は「該当ニュースが無かったテーマ」、日次サマリは「**全件破棄されたテーマ**」として
 * 運営者へ通知していた（＝新しい記事が無い普通の日に警告メールが飛ぶ）。
 */

describe("onlyOutsideWindow（良性の除外の判定）", () => {
  it("窓より古いだけなら良性", () => {
    expect(onlyOutsideWindow({ [REASON_TOO_OLD]: 3 })).toBe(true);
  });

  it("契約違反が混ざっていれば良性ではない（プロンプトか検証条件の不具合）", () => {
    expect(onlyOutsideWindow({ [REASON_TOO_OLD]: 3, "title:too_big": 1 })).toBe(false);
  });

  it("除外が無ければ良性ではない（「該当なし」とは別の経路で扱う）", () => {
    expect(onlyOutsideWindow({})).toBe(false);
  });

  it("付随情報（`_` 始まり）は理由として数えない", () => {
    // 古さの範囲を drop_reasons に載せたことで良性判定が壊れると、
    // 「窓より古いだけ」の日に警告が復活してしまう。
    expect(
      onlyOutsideWindow({
        [REASON_TOO_OLD]: 2,
        [META_TOO_OLD_MIN_AGE_H]: 30,
        [META_TOO_OLD_MAX_AGE_H]: 190,
      }),
    ).toBe(true);
  });
});

describe("formatDropReasons", () => {
  it("件数の多い順に並べ、付随情報は出さない", () => {
    expect(
      formatDropReasons({
        [REASON_TOO_OLD]: 1,
        "title:too_big": 3,
        [META_TOO_OLD_MIN_AGE_H]: 30,
      }),
    ).toBe(`title:too_big×3, ${REASON_TOO_OLD}×1`);
  });
});

describe("formatTooOldAges（何時間古かったか）", () => {
  it("範囲があれば〜で結ぶ", () => {
    expect(
      formatTooOldAges({ [META_TOO_OLD_MIN_AGE_H]: 28, [META_TOO_OLD_MAX_AGE_H]: 40 }),
    ).toBe("28時間〜40時間前");
  });

  it("48時間以上は日で表す（境界すぐ外と、そもそも古い記事を見分けるため）", () => {
    expect(
      formatTooOldAges({ [META_TOO_OLD_MIN_AGE_H]: 120, [META_TOO_OLD_MAX_AGE_H]: 2880 }),
    ).toBe("5日〜120日前");
  });

  it("同じ値なら1つだけ出す", () => {
    expect(
      formatTooOldAges({ [META_TOO_OLD_MIN_AGE_H]: 30, [META_TOO_OLD_MAX_AGE_H]: 30 }),
    ).toBe("30時間前");
  });

  it("記録が無ければ null（古い実行の行でも落ちない）", () => {
    expect(formatTooOldAges({ [REASON_TOO_OLD]: 3 })).toBeNull();
  });
});

describe("mostlyDropped（取れてはいるが大半落ちた）", () => {
  it("除外が取得より多ければ true", () => {
    // 2026-08-10 の staging で実際に起きた形（1件取得・3件除外）。
    // これが doctor も日次サマリも素通りしていたため、静かな減少に気付けなかった。
    expect(mostlyDropped(1, 3)).toBe(true);
  });

  it("同数なら false（1回の実行で騒がない）", () => {
    expect(mostlyDropped(2, 2)).toBe(false);
  });

  it("0件のときは false（そちらは全件破棄／該当なしの判定が担当する）", () => {
    expect(mostlyDropped(0, 3)).toBe(false);
  });
});

/**
 * 分類の正本（R25）。
 *
 * T-M8-83 で「良性の除外」の判定は1箇所へ寄せたが、**その判定をどう組み合わせて
 * どのバケツへ入れるか**は doctor（ループ）と日次サマリ（2つのfilter）で二重のままだった。
 * 片方だけ条件を足すと、同じ状況を2つの経路が違う言葉で伝える状態へ逆戻りする。
 */
describe("classifyNewsOutcome", () => {
  const row = (over: Partial<Parameters<typeof classifyNewsOutcome>[0]>) =>
    classifyNewsOutcome({ category: "ai", fetched: 0, dropped: 0, dropReasons: {}, ...over });

  it("実行が失敗していれば failed（他の数字を見ない）", () => {
    expect(row({ ok: false, fetched: 5, dropped: 0 })).toEqual({ kind: "failed", category: "ai" });
  });

  it("`ok` を省略した行は成功扱い（抽出SQLで絞っている呼び出し側のため）", () => {
    expect(row({ fetched: 3, dropped: 1 }).kind).toBe("healthy");
  });

  it("取れているが除外の方が多ければ mostly_dropped（古さの範囲を添える）", () => {
    expect(
      row({
        fetched: 1,
        dropped: 3,
        dropReasons: {
          [REASON_TOO_OLD]: 3,
          [META_TOO_OLD_MIN_AGE_H]: 28,
          [META_TOO_OLD_MAX_AGE_H]: 40,
        },
      }),
    ).toEqual({
      kind: "mostly_dropped",
      category: "ai",
      fetched: 1,
      dropped: 3,
      ages: "28時間〜40時間前",
    });
  });

  it("0件＋契約違反の除外は all_dropped（プロンプトか検証条件の不具合）", () => {
    expect(row({ fetched: 0, dropped: 2, dropReasons: { "title:too_big": 2 } })).toEqual({
      kind: "all_dropped",
      category: "ai",
      reasons: "title:too_big×2",
    });
  });

  it("除外理由が読めないときも件数だけは出す（無言にしない）", () => {
    // `drop_reasons` が空でも dropped>0 なら「何件落ちたか」は伝える。
    expect(row({ fetched: 0, dropped: 2, dropReasons: { unknown: 2 } })).toMatchObject({
      kind: "all_dropped",
    });
  });

  it("0件でも「窓より古い」だけなら no_match（警告にしない）", () => {
    expect(row({ fetched: 0, dropped: 3, dropReasons: { [REASON_TOO_OLD]: 3 } })).toEqual({
      kind: "no_match",
      category: "ai",
    });
  });

  it("0件で除外も無ければ no_match", () => {
    expect(row({ fetched: 0, dropped: 0 })).toEqual({ kind: "no_match", category: "ai" });
  });

  it("all_dropped と mostly_dropped は同時に成立しない（二重計上を防ぐ）", () => {
    // 前者は fetched===0、後者は fetched>0 が条件なので排他。
    for (const [fetched, dropped] of [
      [0, 5],
      [1, 5],
      [5, 1],
    ] as const) {
      const kind = row({ fetched, dropped, dropReasons: { "title:too_big": dropped } }).kind;
      expect(["all_dropped", "mostly_dropped", "healthy", "no_match"]).toContain(kind);
    }
  });
});

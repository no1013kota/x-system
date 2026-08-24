import { describe, expect, it } from "vitest";

import {
  remainingTrialEndSec,
  remainingTrialHeadline,
  remainingTrialLabel,
  remainingTrialPlanNote,
} from "./remaining-trial";

/**
 * 解約後に残っている無料トライアル（T-M8-298・運営者の指示 2026-08-25）。
 * **判定を1か所に置く**のが目的——`/plans`・設定＞課金・Checkout・再開APIが違う答えを出すと
 * 「画面には無料と書いてあるのに請求された」が起きる（実際に起きた）。
 */
const NOW = Date.parse("2026-08-25T10:00:00Z");

describe("remainingTrialEndSec", () => {
  it("期限が未来なら秒で返す", () => {
    expect(remainingTrialEndSec("2026-08-31T06:51:00Z", NOW)).toBe(
      Math.floor(Date.parse("2026-08-31T06:51:00Z") / 1000),
    );
  });

  it("期限切れ・未設定・壊れた値は null（無料期間を作らない）", () => {
    expect(remainingTrialEndSec("2026-08-24T10:00:00Z", NOW)).toBeNull();
    expect(remainingTrialEndSec(null, NOW)).toBeNull();
    expect(remainingTrialEndSec(undefined, NOW)).toBeNull();
    expect(remainingTrialEndSec("not-a-date", NOW)).toBeNull();
  });

  it("ちょうど現在時刻は残っていない扱い（0秒の無料期間を作らない）", () => {
    expect(remainingTrialEndSec(new Date(NOW), NOW)).toBeNull();
  });
});

describe("remainingTrialLabel", () => {
  it("JSTの日付で出す", () => {
    // 2026-08-31T06:51Z = JST 8/31 15:51
    expect(remainingTrialLabel("2026-08-31T06:51:00Z", NOW)).toBe("2026年8月31日");
  });

  it("UTCとJSTで日付がまたぐ時刻でもJSTで判断する", () => {
    // 2026-08-30T15:30Z = JST 8/31 00:30
    expect(remainingTrialLabel("2026-08-30T15:30:00Z", NOW)).toBe("2026年8月31日");
  });
});

describe("文言", () => {
  it("「どのプランでも無料」と言う（元のプランに戻る話に読ませない）", () => {
    expect(remainingTrialHeadline("2026年8月31日")).toBe(
      "無料トライアルは2026年8月31日まで残っています。どのプランでも、その日までは料金が発生しません。",
    );
  });

  it("終了後にいくらになるかを同時に言う（黙って請求を始めない）", () => {
    expect(remainingTrialPlanNote("expert", "2026年8月31日")).toBe(
      "2026年8月31日までは無料でお使いいただけます。その後は月額 ¥14,800 のご請求が始まります。",
    );
  });
});

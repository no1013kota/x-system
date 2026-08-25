import { describe, expect, it } from "vitest";

import {
  INVITE_TIERS,
  commissionAmount,
  formatRateBps,
  maskEmail,
  rateBpsForPaidCount,
  tierProgress,
  nextReferralRateBps,
} from "./config";

describe("招待ランク（invite_cp.md §3）", () => {
  it("累計有料招待人数で率が決まる", () => {
    expect(rateBpsForPaidCount(0)).toBe(3000); // 0人でも「これから適用される率」は30%
    expect(rateBpsForPaidCount(1)).toBe(3000);
    expect(rateBpsForPaidCount(4)).toBe(3000);
    expect(rateBpsForPaidCount(5)).toBe(3500);
    expect(rateBpsForPaidCount(9)).toBe(3500);
    expect(rateBpsForPaidCount(10)).toBe(4000);
    expect(rateBpsForPaidCount(24)).toBe(4000);
    expect(rateBpsForPaidCount(25)).toBe(4500);
    expect(rateBpsForPaidCount(49)).toBe(4500);
    expect(rateBpsForPaidCount(50)).toBe(5000);
    expect(rateBpsForPaidCount(500)).toBe(5000);
  });

  it("ランク表は昇順（率の計算がこの前提に依存する）", () => {
    for (let i = 1; i < INVITE_TIERS.length; i++) {
      expect(INVITE_TIERS[i].minPaidUsers).toBeGreaterThan(INVITE_TIERS[i - 1].minPaidUsers);
      expect(INVITE_TIERS[i].rateBps).toBeGreaterThan(INVITE_TIERS[i - 1].rateBps);
    }
  });

  it("0人のとき「次のランク」は同率の第1段ではなく35%（あと5人）", () => {
    const p = tierProgress(0);
    expect(p.currentRateBps).toBe(3000);
    expect(p.next?.rateBps).toBe(3500);
    expect(p.remainingToNext).toBe(5);
  });

  it("次ランクまでの残数（8人なら あと2人で40%）", () => {
    const p = tierProgress(8);
    expect(p.currentRateBps).toBe(3500);
    expect(p.next?.rateBps).toBe(4000);
    expect(p.remainingToNext).toBe(2);
    // 最上位は次が無い
    expect(tierProgress(50).next).toBeNull();
    expect(tierProgress(50).remainingToNext).toBe(0);
  });
});

describe("報酬額", () => {
  it("実際に支払われた金額×率（切り捨て・invite_cp.md §6の例）", () => {
    expect(commissionAmount(4980, 2500)).toBe(1245);
    expect(commissionAmount(3980, 2000)).toBe(796);
    expect(commissionAmount(1480, 2000)).toBe(296);
    expect(commissionAmount(0, 2500)).toBe(0);
  });

  it("率の表示", () => {
    expect(formatRateBps(2500)).toBe("25%");
    expect(formatRateBps(2050)).toBe("20.5%");
  });
});

describe("maskEmail", () => {
  it("先頭1文字とドメインだけ残す", () => {
    expect(maskEmail("yamada@gmail.com")).toBe("y***@gmail.com");
    expect(maskEmail("a@b.jp")).toBe("a***@b.jp");
    expect(maskEmail("broken")).toBe("***");
  });
});

/**
 * 次の1人に適用される率（要決定D-41・運営者の判断 2026-08-25「案B」）。
 * 率は「その紹介を**含めた**累計人数」で決まるので、画面の「現在の率」と
 * 次の紹介の率は**あと1人でランクが上がる人だけ食い違う**。
 */
describe("nextReferralRateBps", () => {
  it("あと1人でランクが上がる人は、次の紹介から上の率になる", () => {
    // 4人目まで30%。5人目（＝次の紹介）から35%。
    expect(rateBpsForPaidCount(4)).toBe(3000);
    expect(nextReferralRateBps(4)).toBe(3500);
    expect(nextReferralRateBps(9)).toBe(4000);
    expect(nextReferralRateBps(24)).toBe(4500);
    expect(nextReferralRateBps(49)).toBe(5000);
  });

  it("段の途中では現在の率と同じ（画面は同じ数字を2回書かない）", () => {
    for (const n of [0, 1, 5, 10, 25, 50, 100]) {
      expect(nextReferralRateBps(n)).toBe(rateBpsForPaidCount(n));
    }
  });
});

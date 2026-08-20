import { describe, expect, it } from "vitest";

import {
  INVITE_TIERS,
  commissionAmount,
  formatRateBps,
  maskEmail,
  rateBpsForPaidCount,
  tierProgress,
} from "./config";

describe("招待ランク（invite_cp.md §3）", () => {
  it("累計有料招待人数で率が決まる", () => {
    expect(rateBpsForPaidCount(0)).toBe(2000); // 0人でも「これから適用される率」は20%
    expect(rateBpsForPaidCount(1)).toBe(2000);
    expect(rateBpsForPaidCount(4)).toBe(2000);
    expect(rateBpsForPaidCount(5)).toBe(2500);
    expect(rateBpsForPaidCount(9)).toBe(2500);
    expect(rateBpsForPaidCount(10)).toBe(3000);
    expect(rateBpsForPaidCount(24)).toBe(3000);
    expect(rateBpsForPaidCount(25)).toBe(3500);
    expect(rateBpsForPaidCount(49)).toBe(3500);
    expect(rateBpsForPaidCount(50)).toBe(4000);
    expect(rateBpsForPaidCount(500)).toBe(4000);
  });

  it("ランク表は昇順（率の計算がこの前提に依存する）", () => {
    for (let i = 1; i < INVITE_TIERS.length; i++) {
      expect(INVITE_TIERS[i].minPaidUsers).toBeGreaterThan(INVITE_TIERS[i - 1].minPaidUsers);
      expect(INVITE_TIERS[i].rateBps).toBeGreaterThan(INVITE_TIERS[i - 1].rateBps);
    }
  });

  it("次ランクまでの残数（8人なら あと2人で30%）", () => {
    const p = tierProgress(8);
    expect(p.currentRateBps).toBe(2500);
    expect(p.next?.rateBps).toBe(3000);
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

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
  /*
    区切りは **1〜5 / 6〜10 / 11〜25 / 26〜50 / 51〜**（運営者の指示 2026-08-25）。
    以前は 1〜4 / 5〜9 / … で、表の見出しの人数と実際に上がる人数が1人ずれていた。
    **帯の両端を必ず見る**——片側だけだと1人ずれても気付けない。
  */
  it("累計有料招待人数で率が決まる（帯の両端）", () => {
    expect(rateBpsForPaidCount(0)).toBe(3000); // 0人でも「これから適用される率」は30%
    expect(rateBpsForPaidCount(1)).toBe(3000);
    expect(rateBpsForPaidCount(5)).toBe(3000);
    expect(rateBpsForPaidCount(6)).toBe(3500);
    expect(rateBpsForPaidCount(10)).toBe(3500);
    expect(rateBpsForPaidCount(11)).toBe(4000);
    expect(rateBpsForPaidCount(25)).toBe(4000);
    expect(rateBpsForPaidCount(26)).toBe(4500);
    expect(rateBpsForPaidCount(50)).toBe(4500);
    expect(rateBpsForPaidCount(51)).toBe(5000);
    expect(rateBpsForPaidCount(500)).toBe(5000);
  });

  it("画面に出す帯の表記が 1〜5 / 6〜10 / 11〜25 / 26〜50 / 51〜 になる", () => {
    // 招待画面のランク表は INVITE_TIERS から帯を組み立てる（同じ式をここで固定する）。
    const bands = INVITE_TIERS.map((tier, i) => {
      const next = INVITE_TIERS[i + 1];
      return next ? `${tier.minPaidUsers}〜${next.minPaidUsers - 1}人` : `${tier.minPaidUsers}人〜`;
    });
    expect(bands).toEqual(["1〜5人", "6〜10人", "11〜25人", "26〜50人", "51人〜"]);
  });

  it("ランク表は昇順（率の計算がこの前提に依存する）", () => {
    for (let i = 1; i < INVITE_TIERS.length; i++) {
      expect(INVITE_TIERS[i].minPaidUsers).toBeGreaterThan(INVITE_TIERS[i - 1].minPaidUsers);
      expect(INVITE_TIERS[i].rateBps).toBeGreaterThan(INVITE_TIERS[i - 1].rateBps);
    }
  });

  /*
    **進捗は「ランクアップが成立する人数」を分母にする**（運営者の指示 2026-08-25
    「5人招待が完了した時点でランクアップ」）。`minPaidUsers` は「その率で報酬が出る
    最初の人数」（6人目）なので、分母にそのまま使うと「0 / 6人」になって数え方と食い違う。
  */
  it("0人のときは「あと5人で35%」「0 / 5人」", () => {
    const p = tierProgress(0);
    expect(p.currentRateBps).toBe(3000);
    expect(p.next?.rateBps).toBe(3500);
    expect(p.remainingToNext).toBe(5);
    expect(p.nextAtCount).toBe(5);
  });

  it("次ランクまでの残数（8人なら あと2人で40%・8 / 10人）", () => {
    const p = tierProgress(8);
    expect(p.currentRateBps).toBe(3500);
    expect(p.next?.rateBps).toBe(4000);
    expect(p.remainingToNext).toBe(2);
    expect(p.nextAtCount).toBe(10);
  });

  it("4人のときは まだ35%が目標（0 / 5人 の帯の中）", () => {
    const p = tierProgress(4);
    expect(p.next?.rateBps).toBe(3500);
    expect(p.nextAtCount).toBe(5);
    expect(p.remainingToNext).toBe(1);
  });

  /*
    **必要人数を招待し終えたら目標は次の段へ進む**（運営者の指示 2026-08-25
    「5人ちょうどの時は 5 / 10人」）。5人で止めると「5 / 5人」「あと0人」という、
    もう達成しているのに残っているような表示になる。
  */
  it("5人ちょうどで目標が10人へ進む（5 / 10人・あと5人で40%）", () => {
    const p = tierProgress(5);
    expect(p.nextAtCount).toBe(10);
    expect(p.remainingToNext).toBe(5);
    expect(p.next?.rateBps).toBe(4000);
  });

  it("どの段の境目でも目標が進み、残りが0にならない", () => {
    for (const [count, at] of [[5, 10], [10, 25], [25, 50]] as const) {
      const p = tierProgress(count);
      expect(p.nextAtCount, `${count}人での目標`).toBe(at);
      expect(p.remainingToNext, `${count}人で残りが0になっている`).toBeGreaterThan(0);
    }
  });

  it("50人を招待し終えたら最上位（次が無い）", () => {
    // 51人目から50%なので、50人招待し終えた時点で最上位に達している。
    expect(tierProgress(50).next).toBeNull();
    expect(tierProgress(50).remainingToNext).toBe(0);
    expect(tierProgress(51).next).toBeNull();
    expect(tierProgress(51).nextAtCount).toBe(0);
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
    // 5人目まで30%。6人目（＝次の紹介）から35%。
    expect(rateBpsForPaidCount(5)).toBe(3000);
    expect(nextReferralRateBps(5)).toBe(3500);
    expect(nextReferralRateBps(10)).toBe(4000);
    expect(nextReferralRateBps(25)).toBe(4500);
    expect(nextReferralRateBps(50)).toBe(5000);
  });

  it("段の途中では現在の率と同じ（画面は同じ数字を2回書かない）", () => {
    for (const n of [0, 1, 6, 11, 26, 51, 100]) {
      expect(nextReferralRateBps(n)).toBe(rateBpsForPaidCount(n));
    }
  });
});

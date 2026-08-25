import { describe, expect, it } from "vitest";

import {
  judgeStripeAccount,
  probeStripeAccount,
  type StripeAccountSummary,
} from "./stripe-account-status";

/**
 * T-M8-148。**「契約の申し込みが必ず失敗する」を押す前に知る。**
 *
 * 2026-08-18、本番で「7日間無料で利用」が必ず失敗した（`Your account cannot currently make
 * live charges.`）。原因はStripeアカウントの本番有効化が未完了だったこと。鍵は本番・Priceの
 * 金額も一致・ポータルも有効だったため、**既存の検査はすべて緑**で、押した人だけが行き止まりに
 * なっていた（CLAUDE.md 原則1・2）。
 */
function gateway(account: StripeAccountSummary) {
  return { accounts: { retrieve: async () => account } };
}

describe("probeStripeAccount", () => {
  it("鍵が無ければ問い合わせない", async () => {
    expect(await probeStripeAccount({})).toEqual({ unavailable: true });
  });

  it("問い合わせに失敗したら失敗として残す（正常と混ぜない）", async () => {
    const snapshot = await probeStripeAccount({
      stripe: {
        accounts: {
          retrieve: async () => {
            throw new Error("network");
          },
        },
      },
    });
    expect(snapshot.probeFailed).toBe(true);
  });

  it("能力（card_payments）まで読む", async () => {
    const snapshot = await probeStripeAccount({
      stripe: gateway({
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: true,
        capabilities: { card_payments: "inactive" },
      }),
      requireLiveCharges: true,
    });
    expect(snapshot).toMatchObject({
      chargesEnabled: false,
      detailsSubmitted: true,
      cardPayments: "inactive",
      requireLiveCharges: true,
    });
  });
});

describe("judgeStripeAccount", () => {
  it("鍵が無い環境では赤くしない", () => {
    expect(judgeStripeAccount({ unavailable: true }).level).toBe("ok");
  });

  it("問い合わせ失敗は注意（正常と言わない）", () => {
    expect(judgeStripeAccount({ probeFailed: true }).level).toBe("warn");
  });

  it("受け付けられるなら正常。入金未有効はその旨も出す", () => {
    const ok = judgeStripeAccount({ chargesEnabled: true, payoutsEnabled: true });
    expect(ok.level).toBe("ok");
    expect(ok.detail).toContain("入金も有効");
    const noPayout = judgeStripeAccount({ chargesEnabled: true, payoutsEnabled: false });
    expect(noPayout.level).toBe("ok");
    expect(noPayout.detail).toContain("銀行口座");
  });

  it("本番で受け付けられないなら異常。審査中と未提出を言い分ける（2026-08-18の実例）", () => {
    const reviewing = judgeStripeAccount({
      chargesEnabled: false,
      detailsSubmitted: true,
      cardPayments: "inactive",
      requireLiveCharges: true,
    });
    expect(reviewing.level).toBe("error");
    expect(reviewing.detail).toContain("提出済み");
    expect(reviewing.detail).toContain("必ず失敗");
    expect(reviewing.nextAction).toContain("Stripeダッシュボード");

    const notSubmitted = judgeStripeAccount({
      chargesEnabled: false,
      detailsSubmitted: false,
      cardPayments: "inactive",
      requireLiveCharges: true,
    });
    expect(notSubmitted.detail).toContain("有効化");
    expect(notSubmitted.nextAction).toContain("本人確認");
  });

  it("本番以外では注意に留める（テスト環境の有効化を求めない）", () => {
    expect(
      judgeStripeAccount({
        chargesEnabled: false,
        detailsSubmitted: true,
        requireLiveCharges: false,
      }).level,
    ).toBe("warn");
  });

  it("「時間をおいて」と言わない（待っても直らない）", () => {
    const check = judgeStripeAccount({
      chargesEnabled: false,
      detailsSubmitted: true,
      requireLiveCharges: true,
    });
    expect(`${check.detail}${check.nextAction ?? ""}`).not.toContain("時間をおいて");
  });
});

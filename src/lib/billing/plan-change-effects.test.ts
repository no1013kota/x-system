import { describe, expect, it } from "vitest";

import { planChangeEffects } from "./plan-change-effects";

/**
 * プラン変更の結果を**押す前に**画面へ出すための文言（T-M8-55）。
 *
 * 「いつから変わるのか」「支払いはどうなるのか」は利用者からの実際の質問。
 * 以前は画面に書かれておらず、押してStripeへ移動するまで分からなかった。
 * 文言はStripe側の設定（`setup-stripe-portal.mjs`）と1対1で対応させる。
 */
const base = {
  subscriptionStatus: "active",
  currentPeriodEnd: "2026-08-12T00:00:00.000Z",
  cancelAtPeriodEnd: false,
};

describe("planChangeEffects", () => {
  it("上位プランは即時＋日割り（proration_behavior=create_prorations）", () => {
    const e = planChangeEffects(base);
    expect(e.upgrade.headline).toContain("すぐに切り替わります");
    expect(e.upgrade.detail).toContain("日割り");
  });

  it("下位プランは期間末（schedule_at_period_end=decreasing_item_amount）で、日付を出す", () => {
    const e = planChangeEffects(base);
    expect(e.downgrade.headline).toContain("2026年8月12日");
    // 返金なしの明示は解約側に残す（下位変更の注記はT-M8-66の簡潔化で削減。
    // 返金条件の正式な開示は利用規約第5条・特商法表記・申込前確認事項が担う）。
    expect(e.downgrade.detail).toContain("今のプランのまま使えます");
  });

  it("解約は期間末まで使えて返金なし（mode=at_period_end / proration_behavior=none）", () => {
    const e = planChangeEffects(base);
    expect(e.cancel.headline).toContain("2026年8月12日");
    expect(e.cancel.detail).toContain("返金はありません");
  });

  it("すでに解約予約済みなら、その旨だけを伝える（二重に不安を与えない）", () => {
    const e = planChangeEffects({ ...base, cancelAtPeriodEnd: true });
    expect(e.cancel.detail).toContain("すでに");
    expect(e.cancel.detail).not.toContain("返金はありません");
  });

  /**
   * **トライアル中は日割りの話をしない**（T-M8-243）。Portal設定は `continue_trial` で、
   * トライアル中に変更しても無料期間は変わらず、終了後に新しい料金で請求が始まる。
   * 以前は「差額は日割りで次回請求に加算」と「終了日まで請求は発生しない」が同時に出ていた。
   */
  it("トライアル中は日割りを言わず、終了日まで無料であることを両方向で説明する", () => {
    const e = planChangeEffects({ ...base, subscriptionStatus: "trialing" });
    for (const item of [e.upgrade, e.downgrade]) {
      expect(item.detail).toContain("料金が発生しません");
      expect(item.detail, "トライアル中に日割りの説明を出さない").not.toContain("日割り");
    }
    // 同じことを2か所に書かない（注記は本文へ畳んだ）。
    expect(e.trialNote).toBeNull();
  });

  it("トライアル中でなければ注記を出さない", () => {
    expect(planChangeEffects(base).trialNote).toBeNull();
  });

  // **存在しない日付を作らない。** 期間終了日が無いときに「1970年1月1日」等を出すと、
  // 利用者はその日付を信じて予定を立ててしまう。
  it("期間終了日が無い・壊れている場合は日付を作らず言い換える", () => {
    for (const value of [null, "not-a-date"]) {
      const e = planChangeEffects({ ...base, currentPeriodEnd: value });
      expect(e.downgrade.headline).toContain("現在の期間の終了日");
      expect(e.downgrade.headline).not.toMatch(/\d{4}年/);
    }
  });

  it("日付はJSTで表示する（UTC深夜のずれで前日を出さない）", () => {
    // 2026-08-11T15:00:00Z = JST 2026-08-12 00:00
    const e = planChangeEffects({ ...base, currentPeriodEnd: "2026-08-11T15:00:00.000Z" });
    expect(e.downgrade.headline).toContain("2026年8月12日");
  });

  // 画面に `**` が出た事故の再発防止（Reactはそのまま文字として描く）。
  it("文言にMarkdownの強調記号を混ぜない", () => {
    const e = planChangeEffects({ ...base, subscriptionStatus: "trialing" });
    for (const item of [e.upgrade, e.downgrade, e.cancel, e.trialNote]) {
      if (!item) continue; // trialNote は本文へ畳んだので null になり得る（T-M8-243）
      expect(item.headline).not.toContain("*");
      expect(item.detail).not.toContain("*");
    }
  });
});

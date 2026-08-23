import { describe, expect, it } from "vitest";

import { judgePortalFeatures } from "./portal-features";

/**
 * プラン管理の機能が Stripe 側で有効かの判定（T-M8-32）。
 *
 * 2026-08-03、「プランを変更」を押すとエラーになった。アプリではなく**Stripe側の設定**で
 * `subscription_update` が無効だったため。押して初めて分かる状態にしない。
 */
describe("judgePortalFeatures", () => {
  it("両方有効なら ok", () => {
    const r = judgePortalFeatures({
      features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true } },
    });
    expect(r.level).toBe("ok");
    expect(r.disabled).toEqual([]);
  });

  it("**無効な機能は error**（ボタンが出ているのに押すと失敗するため注意では弱い）", () => {
    const r = judgePortalFeatures({
      features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true } },
    });
    expect(r.level).toBe("error");
    expect(r.disabled).toEqual(["プランを変更"]);
    // 何が起きるかを運営者の言葉で書く
    expect(r.detail).toContain("プランを変更");
    expect(r.detail).toContain("押すと失敗");
  });

  it("キーが無い場合も無効として扱う（`enabled` が来ないことを有効と読まない）", () => {
    const r = judgePortalFeatures({ features: {} });
    expect(r.level).toBe("error");
    expect(r.disabled).toEqual(["プランを変更", "解約する"]);
  });

  it("configuration未設定は warn（Stripeの既定に依存する）", () => {
    const r = judgePortalFeatures({ features: null, configurationMissing: true });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("STRIPE_PORTAL_CONFIGURATION_ID");
  });

  it("問い合わせできなかったときは warn（設定が悪いと決めつけない）", () => {
    expect(judgePortalFeatures({ features: null }).level).toBe("warn");
  });
});

/**
 * 「設定IDが別環境のもの」を名指しする（T-M8-55）。
 *
 * 2026-08-05、`.env.local` の `STRIPE_PORTAL_CONFIGURATION_ID` が staging の値へ上書きされ、
 * ローカルの鍵で staging の設定を参照して `No such configuration` になった。
 * 画面には「プラン管理画面を開けませんでした。時間をおいてもう一度お試しください」と出るが、
 * **待っても直らない**。汎用の「確認できませんでした」では原因に辿り着けない（原則2）。
 */
describe("設定IDが見つからないとき", () => {
  it("エラーとして扱い、別環境の値の可能性を名指しする", () => {
    const r = judgePortalFeatures({ features: null, configurationNotFound: true });
    expect(r.level).toBe("error");
    expect(r.detail).toContain("STRIPE_PORTAL_CONFIGURATION_ID");
    expect(r.detail).toContain("別の環境の値");
  });

  it("単に届かなかった場合とは区別する（そちらは注意のまま）", () => {
    const r = judgePortalFeatures({ features: null });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("確認できませんでした");
  });

  it("未設定とも区別する（Stripeの既定が使われるだけなので注意）", () => {
    const r = judgePortalFeatures({ features: null, configurationMissing: true });
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("未設定");
  });
});

/**
 * 「確認できていない」で終わらせない（T-M8-128）。
 *
 * 2026-08-18、ローカルで「プランを変更」が開けず、doctorは
 * 「プラン管理画面の設定を確認できませんでした」とだけ出していた。**状態は言うが次にやることが
 * 無い**ので運営者はそこで止まった（CLAUDE.md 原則2）。判定ごとに次の一手を持たせる。
 */
describe("次にやること", () => {
  it("Stripeへ問い合わせできないときは、鍵と再起動を案内する", () => {
    const r = judgePortalFeatures({ features: null });
    expect(r.nextAction).toBeDefined();
    expect(r.nextAction).toContain("STRIPE_SECRET_KEY");
    // envは起動時に読むので、あとから足した値は再起動しないと反映されない。
    expect(r.nextAction).toContain("再起動");
  });

  it("設定IDが未設定・見つからないときも、状態だけで終わらせない", () => {
    // 未設定はStripeの既定で動くので警告に留めるが、設定名は必ず出す（どこを直すか分かる）。
    expect(
      judgePortalFeatures({ features: null, configurationMissing: true }).detail,
    ).toContain("STRIPE_PORTAL_CONFIGURATION_ID");
    // 見つからない＝別環境の値。errorにして、doctor側が直すコマンドを出す。
    expect(judgePortalFeatures({ features: null, configurationNotFound: true }).level).toBe(
      "error",
    );
  });

  it("正常なときは次の一手を出さない（読まなくてよいものを増やさない）", () => {
    const r = judgePortalFeatures({
      features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true } },
    });
    expect(r.level).toBe("ok");
    expect(r.nextAction).toBeUndefined();
  });

  /**
   * 金額と時期を決める設定のずれ（T-M8-238/267）。`enabled` だけでは守れない。
   */
  it("日割り差額がその場で決済されない設定（create_prorations）は error", () => {
    const ok = { subscription_update: { enabled: true }, subscription_cancel: { enabled: true } };
    const r = judgePortalFeatures({
      features: ok,
      subscriptionUpdate: { trialUpdateBehavior: "continue_trial", prorationBehavior: "create_prorations" },
    });
    expect(r.level).toBe("error");
    expect(r.detail).toContain("proration_behavior=create_prorations");
    expect(r.nextAction).toContain("stripe:portal:setup");
    expect(
      judgePortalFeatures({
        features: ok,
        subscriptionUpdate: { trialUpdateBehavior: "continue_trial", prorationBehavior: "always_invoice" },
      }).level,
    ).toBe("ok");
  });
});

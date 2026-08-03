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

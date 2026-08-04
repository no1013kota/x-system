/**
 * 画面が前提にしている Customer Portal の機能が、**Stripe側の設定でも有効か**を判定する（T-M8-32）。
 *
 * ## なぜ要るか
 *
 * 2026-08-03、設定の「プランを変更」を押すとエラーになった。原因はアプリではなく
 * **Stripe側の Portal Configuration で `subscription_update` が無効**だったこと
 * （`scripts/setup-stripe-portal.mjs` は有効で作るが、env が古い configuration を指していた）。
 *
 * これは CLAUDE.md「変更影響 → 必須の検証」の**外部サービスの設定に依存する画面**と同じ型で、
 * **相手側の設定はコードに現れず、モックしたテストでは原理的に見えない**（2026-08-01 の Turnstile
 * と同じ）。押して初めて分かるのではなく、状態確認（doctor）で分かるようにする。
 */

/** 画面のボタンが依存している機能。ここに足したら doctor も自動で見るようになる。 */
export const REQUIRED_PORTAL_FEATURES = [
  { key: "subscription_update", label: "プランを変更" },
  { key: "subscription_cancel", label: "解約する" },
] as const;

export type PortalFeatureKey = (typeof REQUIRED_PORTAL_FEATURES)[number]["key"];

export interface PortalFeatureSnapshot {
  /** 取得できた configuration の features（`enabled` だけを見る）。取得できなければ null。 */
  features: Partial<Record<PortalFeatureKey, { enabled?: boolean } | undefined>> | null;
  /** `STRIPE_PORTAL_CONFIGURATION_ID` が未設定なら true（Stripeの既定設定が使われる）。 */
  configurationMissing?: boolean;
  /**
   * 設定IDがこのStripeアカウントに存在しない（T-M8-55）。
   *
   * **別環境の値が入っている典型的な事故。** 2026-08-05、`.env.local` の
   * `STRIPE_PORTAL_CONFIGURATION_ID` が staging の値へ上書きされており、ローカルの鍵で
   * staging の設定を参照して `No such configuration` になった。「確認できませんでした」
   * では原因に辿り着けないので、これだけは名指しする（CLAUDE.md 原則2）。
   */
  configurationNotFound?: boolean;
}

export interface PortalFeatureJudgement {
  level: "ok" | "warn" | "error";
  detail: string;
  /** 無効になっている機能の画面上の名前。 */
  disabled: string[];
}

/**
 * 判定。**無効な機能があれば error**（画面にボタンが出ているのに押すと失敗するため、
 * 「注意」では弱い）。configuration が未設定なら warn（Stripeの既定に依存する）。
 */
export function judgePortalFeatures(snapshot: PortalFeatureSnapshot): PortalFeatureJudgement {
  if (snapshot.configurationMissing) {
    return {
      level: "warn",
      detail:
        "プラン管理画面の設定（STRIPE_PORTAL_CONFIGURATION_ID）が未設定です。Stripeの既定設定で開くため、プラン変更や解約ができない場合があります",
      disabled: [],
    };
  }
  if (snapshot.configurationNotFound) {
    return {
      // **error にする**。画面のボタンは出るが押すと必ず失敗するので「注意」では弱い。
      level: "error",
      detail:
        "設定ID（STRIPE_PORTAL_CONFIGURATION_ID）がこのStripeアカウントに見つかりません。別の環境の値が入っている可能性があります",
      disabled: [],
    };
  }
  if (!snapshot.features) {
    return {
      level: "warn",
      detail: "プラン管理画面の設定を確認できませんでした（Stripeへ問い合わせできていません）",
      disabled: [],
    };
  }
  const disabled = REQUIRED_PORTAL_FEATURES.filter(
    (feature) => snapshot.features?.[feature.key]?.enabled !== true,
  ).map((feature) => feature.label);
  if (disabled.length === 0) {
    return {
      level: "ok",
      detail: "プラン変更・解約のどちらも操作できます",
      disabled: [],
    };
  }
  return {
    level: "error",
    detail: `Stripe側の設定で使えない操作があります: ${disabled.join("・")}。画面にはボタンが出ますが押すと失敗します`,
    disabled,
  };
}

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

/**
 * トライアル中にプラン変更したときの挙動（T-M8-238）。正本は `scripts/setup-stripe-portal.mjs`
 * が設定する `continue_trial`＝**無料期間は変わらず、終了後に新しい料金で請求が始まる**。
 * `end_trial` になっていると**その場で無料期間が終わり即時課金される**——LPの
 * 「7日間は無料」と食い違い、金額の事故になる（2026-08-23、ローカルで実際に ¥14,800 が課金された）。
 */
export const EXPECTED_TRIAL_UPDATE_BEHAVIOR = "continue_trial";

/**
 * 値上げ時の日割り差額の扱い（T-M8-270）。`create_prorations`＝日割り行を作り**次回請求へ合算**する。
 * `always_invoice` にするとその場で決済され、Stripe の確認画面に**差し替えできない**
 * 「本日が期日の金額」という分かりにくい見出しが出る（運営者の指示 2026-08-23 で戻した）。
 * 日割りの説明はプラン説明（`setup-stripe-portal.mjs` の `PLAN_CHANGE_NOTE`）が担う。
 */
export const EXPECTED_PRORATION_BEHAVIOR = "create_prorations";

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
  /**
   * `subscription_update` の中身（T-M8-238）。**`enabled` だけでは金額と時期は守れない。**
   * 取得できないときは undefined（判定しない）。
   */
  subscriptionUpdate?: {
    /** `continue_trial` / `end_trial` など。 */
    trialUpdateBehavior?: string | null;
    /** `always_invoice` / `create_prorations` / `none`。 */
    prorationBehavior?: string | null;
    /**
     * 変更先として提示できる Price の一覧（`expand` しないと返らない）。
     * **明示していない設定では undefined**（Stripeの既定に任せる形）なので、その場合は判定しない。
     */
    priceIds?: string[];
  };
  /** いまアプリが契約に使っている Price（`STRIPE_PRICE_IDS`）。 */
  expectedPriceIds?: string[];
  /**
   * 解約前に提示するクーポンの状態（T-M8-272）。`unset` は提示されない状態、`invalid` は
   * 設定はあるがStripeに無い／無効。判定できないときは `unknown`（判定しない）。
   */
  retentionCoupon?: "unset" | "valid" | "invalid" | "unknown";
}

export interface PortalFeatureJudgement {
  level: "ok" | "warn" | "error";
  detail: string;
  /** 無効になっている機能の画面上の名前。 */
  disabled: string[];
  /**
   * 次にやること（T-M8-128）。**「確認できていない」で終わらせない**——
   * 状態だけ告げられても運営者は動けない（原則2）。判定ごとに書けるようにする。
   */
  nextAction?: string;
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
      // **「確認できていない」ことを言うだけでは足りない**（T-M8-128）。
      // 2026-08-18、ローカルで「プランを変更」が開けず、doctorはこの文言を出していたが
      // 次にやることが書かれておらず、運営者はここで止まった（原則2）。
      // 問い合わせできない＝Stripeの鍵が読めていない、が実際にはほぼ唯一の原因。
      level: "warn",
      detail:
        "プラン管理画面の設定を確認できませんでした（Stripeへ問い合わせできていません）。" +
        "STRIPE_SECRET_KEY が読めていない可能性があります",
      disabled: [],
      nextAction:
        "`.env.local` に STRIPE_SECRET_KEY があるか確認し、**あるのにこの表示が出るなら " +
        "`npm run dev` を再起動**してください（envは起動時に読むため、あとから足した値は反映されません）",
    };
  }
  const disabled = REQUIRED_PORTAL_FEATURES.filter(
    (feature) => snapshot.features?.[feature.key]?.enabled !== true,
  ).map((feature) => feature.label);
  if (disabled.length === 0) {
    /*
      **`enabled` が立っていても、中身がずれていれば押した人が損をする**（T-M8-238）。
      2026-08-23 の監査で、本番の設定は「変更先の Price が旧価格3件のまま」（＝現行プランへ
      変更できない）、ローカルは `end_trial`（＝トライアル中の変更で即時課金）になっていた。
      どちらも `enabled` だけを見る検査では緑のままだった。
    */
    const drift: string[] = [];
    const behavior = snapshot.subscriptionUpdate?.trialUpdateBehavior;
    if (behavior != null && behavior !== EXPECTED_TRIAL_UPDATE_BEHAVIOR) {
      drift.push(
        `トライアル中にプラン変更すると無料期間が終了して即時課金されます（trial_update_behavior=${behavior}）`,
      );
    }
    const proration = snapshot.subscriptionUpdate?.prorationBehavior;
    if (proration != null && proration !== EXPECTED_PRORATION_BEHAVIOR) {
      drift.push(
        `プラン変更の差額の扱いが画面の説明と違います（proration_behavior=${proration}。想定は${EXPECTED_PRORATION_BEHAVIOR}＝次回請求へ合算）`,
      );
    }
    if (snapshot.retentionCoupon === "invalid") {
      drift.push(
        "解約前に提示するクーポンがStripeに見つからない（または無効）です（STRIPE_RETENTION_COUPON_ID）",
      );
    }
    const offered = snapshot.subscriptionUpdate?.priceIds;
    const expected = snapshot.expectedPriceIds ?? [];
    if (offered !== undefined && expected.length > 0) {
      const missing = expected.filter((id) => !offered.includes(id));
      if (missing.length > 0) {
        drift.push(
          `いまの料金プランが変更先に入っていません（不足 ${missing.length}/${expected.length} 件）。契約者が「プランを変更」を開けません`,
        );
      }
    }
    if (drift.length > 0) {
      return {
        level: "error",
        detail: `Stripe側の設定が今の料金プランと合っていません: ${drift.join("／")}`,
        disabled: [],
        nextAction:
          "`npm run stripe:portal:setup -- --target <staging|production>` を実行して設定を作り直してください（ローカルは --target local）",
      };
    }
    if (snapshot.retentionCoupon === "unset") {
      return {
        level: "warn",
        detail:
          "プラン変更・解約のどちらも操作できます。ただし解約前のクーポンは提示されません（STRIPE_RETENTION_COUPON_ID が未設定）",
        disabled: [],
        nextAction:
          "引き止めクーポンを出すなら、その環境のクーポンIDを `STRIPE_RETENTION_COUPON_ID` に設定してください（Stripeダッシュボードの「顧客維持クーポン」設定はflow_data経由の解約画面には効きません・T-M8-272）",
      };
    }
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

/**
 * プラン変更・解約が**いつから効いて、支払いがどう変わるか**（T-M8-55）。
 *
 * これは Stripe Customer Portal の configuration（`scripts/setup-stripe-portal.mjs`）で
 * 決まっている挙動をそのまま日本語にしたもの。**押す前に画面へ出す**ためにここへ置く。
 *
 * 以前は「どちらもStripeの安全な画面へ移動します。解約は期間末で…」という1行しか無く、
 * **上位プランへ変えると切り替えは即時で、差額は日割りで次回請求へ合算される**ことも、
 * **下位プランは期間末まで切り替わらない**ことも画面から読めなかった。
 * 金額と時期が変わる操作で、押した後に初めて分かるのは避けたい。
 *
 * 対応する設定（要件03 §2.2）:
 * - `subscription_update.proration_behavior = "create_prorations"` → 値上げは**切り替え即時**。
 *   差額（旧プランの未使用分を引き、新プランの残り期間分を足す・秒単位の日割り）は
 *   **その場では決済されず、次回更新日の請求書に合算**される（実測 2026-08-23）。
 *   `always_invoice`（即時決済）にすると Stripe の確認画面に内訳が出るが、同時に出る
 *   「本日が期日の金額」が分かりにくいため戻した（T-M8-267・運営者の指示）。
 *   Stripeの確認画面は文言を差し替えられないので、日割りの説明は**プラン説明**
 *   （`setup-stripe-portal.mjs` の `PLAN_CHANGE_NOTE`。選択画面でプラン名の直下）とこの画面が担う
 * - `subscription_update.schedule_at_period_end.conditions = [decreasing_item_amount]` → 値下げは期間末
 * - `subscription_update.trial_update_behavior = "continue_trial"` → トライアル中は期限を変えない
 * - `subscription_cancel = { mode: "at_period_end", proration_behavior: "none" }` → 解約は期間末・返金なし
 */

export interface PlanChangeEffectInput {
  /** 契約状態（`trialing` / `active` など）。 */
  subscriptionStatus: string;
  /** 現在の期間終了日（ISO文字列。未設定なら null）。 */
  currentPeriodEnd: string | null;
  /** 既に期間末解約が予約されているか。 */
  cancelAtPeriodEnd: boolean;
}

/**
 * 1項目分の説明。**強調は文字列に埋め込まない**（T-M8-55）。
 *
 * 最初は `**すぐに切り替わります。**` のようにMarkdownで書いたが、Reactはそのまま文字として
 * 描くので画面に `**` が出た。強調する部分を別のフィールドに分け、描画側で要素にする。
 */
export interface PlanChangeEffect {
  /** 太字で見せる結論（「すぐに切り替わります」「2026年8月12日に切り替わります」）。 */
  headline: string;
  /** 補足（日割り・返金の有無など）。 */
  detail: string;
}

export interface PlanChangeEffects {
  /** 上位プランへ変えたときに起きること。 */
  upgrade: PlanChangeEffect;
  /** 下位プランへ変えたときに起きること。 */
  downgrade: PlanChangeEffect;
  /** 解約したときに起きること。 */
  cancel: PlanChangeEffect;
  /** トライアル中だけ添える注記（不要なら null）。 */
  trialNote: PlanChangeEffect | null;
}

/** 「2026年8月12日」。日付が無ければ「期間終了日」と書く（存在しない日付を作らない）。 */
function periodEndLabel(value: string | null): string {
  if (!value) return "現在の期間の終了日";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "現在の期間の終了日";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export function planChangeEffects(input: PlanChangeEffectInput): PlanChangeEffects {
  const end = periodEndLabel(input.currentPeriodEnd);
  const trialing = input.subscriptionStatus === "trialing";

  /*
    **トライアル中は日割りの話をしない**（T-M8-243）。Portal設定は `continue_trial` なので、
    トライアル中に変更しても**無料期間は変わらず、終了後に新しい料金で請求が始まる**。
    にもかかわらず「差額は日割りで次回請求に加算されます」と「終了日まで請求は発生しません」が
    同時に出ており、読み手はどちらが本当か分からなかった（Portal設定と1対1に保つ規約に反する）。
  */
  if (trialing) {
    const trialDetail = `トライアルの終了日（${end}）までは料金が発生しません。終了後に、変更後のプランの料金で請求が始まります。`;
    return {
      upgrade: { headline: "すぐに切り替わります", detail: trialDetail },
      /*
        下位への変更は**期間末に切り替わる**（Portal設定 `schedule_at_period_end` の
        `decreasing_item_amount`）。トライアル中の「期間末」＝トライアル終了日なので、
        上位変更と同じ「すぐに」にはしない。
      */
      downgrade: {
        headline: `${end}に切り替わります`,
        detail: `それまでは今のプランのまま使えます。${trialDetail}`,
      },
      cancel: input.cancelAtPeriodEnd
        ? {
            headline: `${end}に解約されます`,
            detail: "すでに解約が予約されています。料金はかかりません。",
          }
        : {
            headline: `${end}まで使えて、その後停止します`,
            detail: "トライアル中に解約すれば料金はかかりません。",
          },
      /*
        **画面は `headline` しか出さない**（portal-button.tsx）。トライアル中の要点は
        「終了日まで料金が発生しない」ことなので、その1行はここで必ず出す。
        以前の「終了日は変わりません」は、上の日割り説明と食い違って読めた（T-M8-243）。
      */
      trialNote: {
        headline: `トライアルの終了日（${end}）までは料金が発生しません`,
        detail: "終了後に、変更後のプランの料金で請求が始まります。",
      },
    };
  }

  return {
    upgrade: {
      headline: "すぐに切り替わります",
      detail: "差額は日割りで計算され、次回の請求に加算されます",
    },
    downgrade: {
      headline: `${end}に切り替わります`,
      detail: "それまでは今のプランのまま使えます。",
    },
    cancel: input.cancelAtPeriodEnd
      ? {
          headline: `${end}に解約されます`,
          detail: "すでに解約が予約されています。それまでは今のプランのまま使えます。",
        }
      : {
          headline: `${end}まで使えて、その後停止します`,
          detail: "日割りの返金はありません。",
        },
    trialNote: null,
  };
}

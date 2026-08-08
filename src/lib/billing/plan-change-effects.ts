/**
 * プラン変更・解約が**いつから効いて、支払いがどう変わるか**（T-M8-55）。
 *
 * これは Stripe Customer Portal の configuration（`scripts/setup-stripe-portal.mjs`）で
 * 決まっている挙動をそのまま日本語にしたもの。**押す前に画面へ出す**ためにここへ置く。
 *
 * 以前は「どちらもStripeの安全な画面へ移動します。解約は期間末で…」という1行しか無く、
 * **上位プランへ変えると即時に日割り請求が走る**ことも、**下位プランは期間末まで切り替わらない**
 * ことも画面から読めなかった。金額と時期が変わる操作で、押した後に初めて分かるのは避けたい。
 *
 * 対応する設定（要件03 §2.2）:
 * - `subscription_update.proration_behavior = "create_prorations"` → 値上げは即時＋日割り
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
    trialNote: trialing
      ? {
          headline: `トライアルの終了日（${end}）は変わりません`,
          detail: "終了後に、変更後のプランの料金で請求が始まります。",
        }
      : null,
  };
}

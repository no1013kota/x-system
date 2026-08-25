import { DB_ENUMS } from "./db/enums";

/**
 * Plan definitions (要件03 §2, PRD §6). Prices are 税込 JPY; Stripe Price IDs
 * live in env (要件01 §3.3), not here. Operator-managed plans (premium /
 * expert) have app-side monthly usage limits (要件03 §7); standard (BYOK)
 * runs on the user's own API billing.
 * The all-plan daily post safety cap is env-driven (X_DAILY_POST_LIMIT).
 * PlanId is derived from the plan_type DB enum so code and DB never drift.
 */
export type PlanId = (typeof DB_ENUMS.plan_type)[number];

export interface PlanUsageLimits {
  normalPosts: number;
  urlPosts: number;
  /** AIクレジット（T-M8-109。1クレジット=1円相当・文章/画像のAI実行で実費消費）。 */
  aiCredits: number;
}

export interface PlanDefinition {
  id: PlanId;
  displayName: string;
  /** 1行の売り文句。ランディングと/plansで共有する（別々に持つと文言が食い違う・T-M8-66）。 */
  tagline: string;
  /**
     * **実際に請求する月額**（税込）。Stripe Price の金額と必ず一致させる。
     *
     * 突き合わせは**2段**（T-M8-141）:
     * - `constants.test.ts` … この定数が勝手に変わっていないか（リテラルとの比較）
     * - `npm run doctor` … **Stripeの実際のPrice金額との一致**（`ops/price-status.ts`）
     *
     * 以前はここに「`constants.test.ts` が突き合わせる」とだけ書いてあったが、
     * そのテストはStripeを見ていない。**請求額と表示額のズレを誰も検出していなかった。**
     *
     * いまはリリース記念キャンペーンの半額。
     */
  monthlyPriceJpy: number;
  /**
   * キャンペーン終了後の月額（税込）。`monthlyPriceJpy` の2倍。
   *
   * **これは「過去に販売した価格」ではない。** 表示するときは必ず「キャンペーン終了後」と
   * 明示する。景品表示法の二重価格表示は、通常価格として出すなら実際にその価格で
   * 相当期間販売した実績が必要で、この3プランにその実績は無い（`RELEASE_CAMPAIGN`）。
   */
  regularPriceJpy: number;
  xAccountLimit: number;
  /** null = no app-side monthly limits (BYOK plans). */
  usageLimits: PlanUsageLimits | null;
  /** 全プランで true（T-M8-168で旧standardを撤廃）。未知・未契約(null)を弾く機構として残す。 */
  canEditMdAndPrompts: boolean;
  /**
   * 利用枠を画面に出さないか（エキスパート・T-M8-168）。
   *
   * true のプランは残量・上限の**数値をどこにも出さない**。表示は「無制限」、上限到達時は
   * 「連続的な使用が検知されたため一時的に停止しております。お待ちください。」（`usage_paused`）。
   * 数値の上限は不正利用・費用暴走への内部ガードで、通知・エラー details にも数値を載せない。
   * **注記なしで「無制限」と表示するのは運営者の決定**（2026-08-20。景表法の優良誤認リスクは
   * 提示のうえでの判断。利用規約には一時停止があり得る旨を記載する）。
   */
  concealsLimits: boolean;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  // 旧mdプランと同内容（T-M8-168で旧standard(¥500)を撤廃し、mdを「スタンダード」へ改名・改定）。
  standard: {
    id: "standard",
    displayName: "スタンダードプラン",
    tagline: "自分のAPIキーで、手ごろに始める",
    monthlyPriceJpy: 1480,
    regularPriceJpy: 2960,
    xAccountLimit: 1,
    usageLimits: null,
    canEditMdAndPrompts: true,
    concealsLimits: false,
  },
  premium: {
    id: "premium",
    displayName: "プレミアムプラン",
    tagline: "APIキーなしで、運用をまとめておまかせ",
    monthlyPriceJpy: 3980,
    regularPriceJpy: 7960,
    xAccountLimit: 1,
    usageLimits: {
      normalPosts: 200,
      urlPosts: 20,
      aiCredits: 1000,
    },
    canEditMdAndPrompts: true,
    concealsLimits: false,
  },
  expert: {
    id: "expert",
    displayName: "エキスパートプラン",
    tagline: "上限を気にせず、すべておまかせで運用",
    monthlyPriceJpy: 14800,
    regularPriceJpy: 29600,
    // エキスパートだけ複数（利用枠は合算）。standard/premiumは1（2026-08-20運営者の指示）。
    xAccountLimit: 3,
    // 内部ガード（画面に出さない）。到達時は usage_paused（一時停止の文言）を出す。
    usageLimits: {
      normalPosts: 1000,
      urlPosts: 100,
      aiCredits: 5000,
    },
    canEditMdAndPrompts: true,
    concealsLimits: true,
  },
};

/**
 * 運営がAPIキーを用意するプランか（X連携=managed OAuth・AI=運営キー・アプリ側の利用枠あり）。
 * 判定は「利用枠を持つか」と一致させる（plans.ts の定義がその対応の正本）。
 * 旧コードの `plan === "premium"` 比較はプランが増えると漏れるため、この関数だけを使う。
 */
export function isOperatorManagedPlan(plan: string | null | undefined): boolean {
  return plan != null && PLANS[plan as PlanId]?.usageLimits != null;
}

/** 利用枠を画面に出さないプランか（無制限表示・到達時は一時停止の文言）。 */
export function concealsUsageLimits(plan: string | null | undefined): boolean {
  return plan != null && PLANS[plan as PlanId]?.concealsLimits === true;
}

/** そのプランの利用枠。BYOK（アプリ側上限なし）と未知・未契約は null。 */
export function usageLimitsForPlan(
  plan: string | null | undefined,
): PlanUsageLimits | null {
  if (plan == null) return null;
  return PLANS[plan as PlanId]?.usageLimits ?? null;
}

/** Stable tuple shared by input schemas and Stripe price mapping. */
export const PLAN_IDS = DB_ENUMS.plan_type;

/**
 * リリース記念キャンペーン（半額）。**終わらせるときはここだけを直す。**
 *
 * ## 表示の決まり（景品表示法）
 *
 * `regularPriceJpy` を「通常価格」として取り消し線で出すだけにはしない。二重価格表示は、
 * 通常価格として示すなら**実際にその価格で相当期間販売した実績**が必要で、この3プランに
 * その実績は無い（新3プランはキャンペーン価格でのみ販売してきた・T-M8-168）。
 * そのため画面では必ず「キャンペーン終了後の価格」と分かる形で出す（`AFTER_LABEL`）。
 *
 * ## 終わらせる手順
 *
 * 1. Stripeで `regularPriceJpy` の額の Price を作る（Priceの金額は後から変えられない）
 * 2. Vercelの `STRIPE_PRICE_*_MONTHLY` を差し替える
 * 3. `plans.ts` の `monthlyPriceJpy` を `regularPriceJpy` と同じ額にし、`active` を false にする
 *
 * `active` が false になると、取り消し線・バッジ・注記が画面から消える（分岐は各画面ではなく
 * ここが持つ。**キャンペーン表示を消し忘れる場所を作らない**）。
 */
export const RELEASE_CAMPAIGN = {
  /** false にすると全画面からキャンペーン表示が消える。 */
  active: true,
  /** バッジの文言。 */
  badge: "リリース記念 半額",
  /** 取り消し線の価格に添えるラベル。「通常価格」と書かない（上記の理由）。 */
  afterLabel: "キャンペーン終了後",
  /** 注記。終了日を決めたらここに入れる（未定のあいだは期間を約束しない）。 */
  note: "リリース記念として期間限定で半額でご提供しています。終了時期は決まりしだいお知らせします。",
} as const;

/**
 * 解約を止めるための追加割引（2026-08-17 運営者の指示）。
 *
 * **設定はStripeダッシュボードで行う。** カスタマーポータルの「キャンセル管理 ＞ 顧客維持クーポン」で
 * 50%オフのクーポンを指定する。`billing_portal.Configuration` APIには該当フィールドが無いため
 * コードからは設定できない（当アプリのポータル設定は `is_default: true` なので、
 * ダッシュボードの設定がそのまま効く）。ここに書いてあるのは**根拠と金額の記録**で、
 * アプリの動作には影響しない。
 *
 * 適用後の月額（キャンペーン価格のさらに半額）を**3ヶ月**だけ適用する。
 * スタンダード 740円 / プレミアム 1,990円 / エキスパート 7,400円。
 *
 * **運営キー系プランはフル利用だと赤字になる。** premiumの上限までの原価は約3,020〜3,240円、
 * expertの内部ガードまでの原価は約14,900〜15,300円で、割引後の手取りを大きく下回る。
 * **3ヶ月限定なので1人あたりの損失は有限**。運営者が承知のうえで決めている
 * （解約を止める価値が上回るという判断・2026-08-17。金額はT-M8-168の改定に追随）。実績を見て見直す。
 */
export const RETENTION_DISCOUNT = {
  /** Stripeの顧客維持クーポンに設定する割引率（%）。 */
  percentOff: 50,
  /**
   * 割引を適用する月数。Stripeのクーポンでは `duration=repeating` ＋
   * `duration_in_months=3`。**`forever` にしない**（プレミアムは原価を下回るため）。
   */
  durationMonths: 3,
  /** 適用後の月額（表示・記録用。請求はStripeのクーポンが決める）。 */
  monthlyPriceJpy: { standard: 740, premium: 1990, expert: 7400 },
} as const;

/** キャンペーン中で、かつそのプランに割引がある（＝取り消し線を出す）か。 */
export function hasCampaignDiscount(plan: PlanDefinition): boolean {
  return RELEASE_CAMPAIGN.active && plan.regularPriceJpy > plan.monthlyPriceJpy;
}

import type { PlanId } from "@/lib/plans";
import { PLANS } from "@/lib/plans";

/**
 * 解約前の確認とアンケート（T-M8-277・運営者の指示 2026-08-23）。
 *
 * **押したら即Stripeへ、にしない**。解約すると何が止まるのかを先に示し（引き止めではなく事実の確認）、
 * そのうえで理由を任意で聞く。理由が分からないと運営者は何を直せばよいか判断できない。
 * 引き止めのクーポン提示はStripe側の解約画面が担う（要件03 §2.2・T-M8-272）。
 */

/** 選択式の理由。値はDBへそのまま入るので**変えない**（集計が途切れる）。 */
export const CANCELLATION_REASONS = [
  { value: "price", label: "料金が高い" },
  { value: "not_used", label: "あまり使わなかった" },
  { value: "quality", label: "生成される投稿が期待と違った" },
  { value: "difficult", label: "使い方が分かりにくかった" },
  { value: "missing_feature", label: "欲しい機能が無かった" },
  { value: "switched", label: "他のサービスに移る" },
  { value: "temporary", label: "一時的に止めたいだけ" },
  { value: "other", label: "その他" },
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number]["value"];

export function isCancellationReason(value: unknown): value is CancellationReason {
  return CANCELLATION_REASONS.some((r) => r.value === value);
}

/**
 * 解約で止まること（デメリットの提示）。**煽らず、事実だけ**を書く。
 * 期間末までは使えること・データが消えないことも同時に伝える（不安で判断させない）。
 */
export function cancellationEffects(input: {
  plan: PlanId | null;
  /** 期間終了日（JSTの「◯年◯月◯日」表記）。不明なら「現在の期間の終了日」。 */
  endsAtLabel: string;
  /** トライアル中か（トライアル中の解約は終了日まで無料で使える）。 */
  trialing: boolean;
}): { title: string; stops: string[]; keeps: string[] } {
  const plan = input.plan ? PLANS[input.plan] : null;
  const managedKeys = Boolean(plan?.usageLimits);
  return {
    title: input.trialing
      ? "無料トライアルは、解約するとその場で終了します（残りの期間は繰り越せません）"
      : `${input.endsAtLabel}までご利用いただけます。その後は次の機能が止まります`,
    stops: [
      "予約した自動投稿・下書きの自動作成が止まります",
      "ニュースの自動取得と通知が止まります",
      ...(managedKeys ? ["運営が用意しているAIキーでの生成が使えなくなります（ご自身のキーは別途必要です）"] : []),
      "投稿分析（改善提案）の新しい実行ができなくなります",
    ],
    /*
      **「閲覧できます」と書かない**（運営者の指摘 2026-08-24）。データが消えないのは本当だが、
      解約後は課金・プラン以外のタブがロックされる（T-M8-269）ので**開いて見ることはできない**。
      「残ります（閲覧できます）」は事実と違い、解約してから初めて食い違いに気付くことになる。
      消えないことと、見るには再開が要ることを、同じ1行で言い切る。
    */
    keeps: [
      "これまでの下書き・投稿履歴・分析結果は消えません（解約中は開けませんが、再開すればそのまま使えます）",
      "同じアカウントでいつでも再開できます",
      ...(input.trialing
        ? [
            "料金は発生しません（カードへの請求はありません）",
            `${input.endsAtLabel}までなら、残りの期間で無料トライアルを再開できます`,
          ]
        : ["お支払い済みの期間の日割り返金はありません"]),
    ],
  };
}

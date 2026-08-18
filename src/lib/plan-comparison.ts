import { PLANS, type PlanDefinition, type PlanId } from "./plans";

/**
 * プランの違いを1つの表で示す（T-M8-125）。
 *
 * **運営者の指摘（2026-08-18）**: 3プランの違いが分かりにくい。機能を行見出しにして、
 * 各プランに ✓ か − が付く表にしたい。
 *
 * ## ここが正本
 *
 * 行の並びと各プランの可否は**すべて `PLANS` から導く**。画面側に ✓ / − を書き写さない
 * （以前カードの箇条書きを画面ごとに持っていて、`/plans` とLPで内容が食い違った）。
 * 「mdプランの全機能」のような**入れ子の言い方をやめた**のも狙いで、
 * 表なら上位プランに何が積まれるかがその場で見える。
 */

/** 表のセルの中身。`true`/`false` は ✓ / −、文字列はそのまま出す（件数や上限）。 */
export type PlanCell = boolean | string;

export interface PlanComparisonRow {
  /** 行見出し（機能名）。 */
  label: string;
  /** 補足（あれば見出しの下に小さく出す）。 */
  note?: string;
  cell: (plan: PlanDefinition) => PlanCell;
}

export const PLAN_COMPARISON_ROWS: readonly PlanComparisonRow[] = [
  {
    label: "連携できるXアカウント",
    cell: (plan) => `${plan.xAccountLimit}件`,
  },
  {
    label: "ニュースの自動収集",
    note: "設定したテーマの新着を毎日集めます",
    cell: () => true,
  },
  {
    label: "投稿文と画像の自動生成",
    cell: () => true,
  },
  {
    label: "スケジュール投稿・自動投稿",
    cell: () => true,
  },
  {
    label: "投稿実績の記録と分析レポート",
    note: "毎朝、伸びた投稿を根拠つきで示します",
    cell: () => true,
  },
  {
    label: "分析にもとづくプロンプトの改善提案",
    cell: () => true,
  },
  {
    label: "アカウント.md・プロンプトの直接編集",
    note: "AIへの指示を自分で書き換えられます",
    cell: (plan) => plan.canEditMdAndPrompts,
  },
  {
    label: "編集履歴とロールバック",
    cell: (plan) => plan.canEditMdAndPrompts,
  },
  {
    label: "APIキーの用意",
    note: "X・生成AIのキー",
    // BYOKかどうかはアプリ側上限の有無と一致する（plans.ts の定義参照）。
    cell: (plan) => (plan.usageLimits ? "不要" : "自分で用意"),
  },
  {
    label: "月間の利用上限",
    cell: (plan) =>
      plan.usageLimits
        ? `AIクレジット${plan.usageLimits.aiCredits}／通常投稿${plan.usageLimits.normalPosts}／URL付き${plan.usageLimits.urlPosts}`
        : "なし（ご自身のAPI課金の範囲）",
  },
];

/** 表の列（プラン）。`PLAN_IDS` の順に並べる。 */
export function comparisonColumns(): { id: PlanId; plan: PlanDefinition }[] {
  return (Object.keys(PLANS) as PlanId[]).map((id) => ({ id, plan: PLANS[id] }));
}

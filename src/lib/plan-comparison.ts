import { PLANS, type PlanDefinition, type PlanId } from "./plans";
import { yen } from "@/lib/format";

/**
 * プランの違いの行定義（T-M8-125で表向けに作成。T-M8-171からはLP・/plans共通の
 * プランカード `PlanPricingCards` がこの行をそのまま描く）。
 *
 * ## ここが正本
 *
 * 行の並びと各プランの可否は**すべて `PLANS` から導く**。画面側に ✓ / 値を書き写さない
 * （以前カードの箇条書きを画面ごとに持っていて、`/plans` とLPで内容が食い違った）。
 * カードの「変更・追加」の強調も、書き写しではなく下位プランとのセル比較で機械的に決まる。
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

/**
 * 料金表・料金カードに出す機能一覧（T-M8-354・運営者の指示 2026-08-28）。
 *
 * **並びと文言は運営者が決めた一覧をそのまま持つ。** 共通8行のあと、プランで差が出る2行
 * （APIキーの用意・利用上限）を置く。「連携できるXアカウント」はカードでは専用の帯に出すため
 * 機能一覧からは外れる（`ACCOUNT_ROW_LABEL`）。
 */
export const PLAN_COMPARISON_ROWS: readonly PlanComparisonRow[] = [
  {
    label: "連携できるXアカウント",
    cell: (plan) => `${plan.xAccountLimit}件`,
  },
  // ── 全プラン共通 ──────────────────────────────
  {
    label: "ニュースの自動収集",
    note: "設定したテーマの新着を毎日集めます",
    cell: () => true,
  },
  {
    label: "デフォルトプロンプト",
    note: "すぐ使える投稿の型を最初から用意しています",
    cell: () => true,
  },
  {
    label: "投稿文と画像の自動生成",
    cell: () => true,
  },
  {
    label: "投稿の下書き管理・自動投稿",
    cell: () => true,
  },
  {
    label: "投稿予約・投稿スケジュール管理",
    cell: () => true,
  },
  {
    label: "投稿実績の記録と分析レポート",
    note: "伸びた投稿を根拠つきで示します",
    cell: () => true,
  },
  {
    label: "分析にもとづくプロンプトの改善提案",
    cell: () => true,
  },
  {
    label: "プロンプトの管理・編集",
    note: "AIへの指示を自分で書き換えられます",
    // 全プランで編集できる（T-M8-168）。プラン差はもう無いので常に true。
    cell: () => true,
  },
  // ── プランで差が出る2行 ────────────────────────
  {
    label: "AI生成・X連携用の専用鍵（APIキー）",
    // BYOKかどうかはアプリ側上限の有無と一致する（plans.ts の定義参照）。
    // BYOKのAPI実費の開示はこの行が唯一の常時表示（T-M8-171で注意書きを畳んだため落とさない）。
    // 「（利用料はご自身のAPI課金）」は運営者の指示（2026-09-04）で削除。BYOKのAPI実費はキャップ要約「API利用料は別」が言う。
    cell: (plan) => (plan.usageLimits ? "不要" : "自分で用意"),
  },
  {
    label: "利用上限（契約期間ごと）",
    cell: (plan) => {
      // エキスパートは「無制限」と表示する（T-M8-168・運営者の決定）。内部ガード値は出さない。
      if (plan.concealsLimits) return "無制限";
      return plan.usageLimits
        ? `AIクレジット${yen(plan.usageLimits.aiCredits)}／通常投稿${plan.usageLimits.normalPosts}回／URL付き投稿${plan.usageLimits.urlPosts}回`
        : "なし";
    },
  },
];

/** 表の列（プラン）。`PLAN_IDS` の順に並べる。 */
export function comparisonColumns(): { id: PlanId; plan: PlanDefinition }[] {
  return (Object.keys(PLANS) as PlanId[]).map((id) => ({ id, plan: PLANS[id] }));
}

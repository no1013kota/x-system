import type { IconName } from "@/components/ui/icon";
import { OPERATED_THEME_OPTIONS } from "@/lib/themes";

/**
 * /new で数字として出す「製品の事実」（T-M8-419）。
 *
 * すべて実装済みの設定値・仕様値で、出典を添える。コピーの都合で丸めない
 * （禁止表現: 「3分野」「6種類」「一瞬で」「数秒で」）。分野名は `OPERATED_THEME_OPTIONS`
 * から描き、ここに直書きしない。
 */
export interface Stat {
  icon: IconName;
  value: string;
  label: string;
}

/** ニュース分野の表示名（AI・Web3・SNS運用・投資・恋愛・美容）。 */
export const THEME_LABELS = OPERATED_THEME_OPTIONS.map((theme) => theme.label);

export const STATS: Stat[] = [
  // PRD N-1: RSS巡回10分間隔（要件04 §6 news_fetch `*/10`）。
  { icon: "refresh", value: "10分おき", label: "ニュースの自動巡回" },
  // PRD N-1: 6分野。
  {
    icon: "newspaper",
    value: `${THEME_LABELS.length}分野`,
    label: THEME_LABELS.join("・"),
  },
  // PRD §7: 投稿生成（リサーチ含む）は目安60〜90秒。
  { icon: "bolt", value: "60〜90秒", label: "投稿1件（リサーチ込み）" },
  // PRD §3.1: 6種のうち引用ポストは初期提供停止＝利用できるのは5種類。型の追加は上限なし。
  { icon: "article", value: "5種類", label: "標準の型。追加は何個でも" },
  // PRD K-3 / 要件04 §13: 投稿後1日・7日・30日の時点で毎時cronが記録。
  {
    icon: "monitoring",
    value: "1・7・30日",
    label: "表示回数・いいね等の自動記録",
  },
];

/**
 * 「利用している技術」。提携・公式パートナーと読める語は使わない。
 * ロゴ画像は使用条件を確認できた素材が届くまで文字表記（assetWishlist）。同じロボットアイコンを
 * 3連続で並べるとプレースホルダーに見えるため、X だけロゴ、他は文字だけのピルにする。
 * 画像生成の提供元は製品の表示名（アプリ画面・PRD P-7）に合わせて「OpenAI」（「ChatGPT」と書かない）。
 * 暗号方式（AES-256-GCM）はベンダー名と並べず、安心の3カードだけに置く。
 */
export const TECH: { name: string; icon: "x" | null }[] = [
  { name: "X API（公式）", icon: "x" },
  { name: "Claude", icon: null },
  { name: "OpenAI", icon: null },
  { name: "Gemini", icon: null },
  { name: "Stripe", icon: null },
];

/**
 * 「何が出てくるか」セクション（運営者の実投稿3件）は、事実確認と実投稿が揃うまで描画しない。
 * プレースホルダーや架空の投稿で公開しない（禁止表現「架空の利用者の声」）。
 */
export const OUTPUT_ENABLED = false;

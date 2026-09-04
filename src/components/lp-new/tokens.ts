/**
 * /new（先行公開LP・T-M8-419）のレイアウト定数。
 *
 * 「リッチさ」の正体は余白と角丸の一貫性なので、値はここだけに置き、各セクションは
 * この定数を参照する。既存LP（`src/app/page.tsx`）の同名定数は export されていないため
 * 複製しているが、値は /new の設計（コンテナ1240px・セクション間120px・角丸24px）に合わせて
 * 別物にしてある。既存LPには触らない。
 */

export const CONTAINER =
  "mx-auto w-full max-w-[1240px] px-[clamp(20px,4vw,40px)]";
// セルフレビュー（2026-09-03）: 120pxだと図面板→画面ツアーの間が約240px空いて間延びしたため詰めた。
export const SECTION = "py-[clamp(56px,7vw,96px)]";

/**
 * ガラスカード。罫線は引かない（面の差と影だけで区切る）。
 * backdrop-blur は付けない: 背景のブロブは blur-3xl 済みで、さらにぼかしても見た目が変わらず、
 * 24枚のカードが毎フレーム再計算するぶんだけ重くなる（実画面の上に重なるヒーローの板だけ
 * `HERO_BOARD` で backdrop を持つ）。
 */
export const GLASS =
  "rounded-[24px] bg-white/60 shadow-[0_4px_10px_rgba(0,0,0,0.06)]";
/** ヒーローの板: 実画面の切り出し同士が重なるので、ここだけすりガラス。 */
export const HERO_BOARD = `${GLASS} backdrop-blur-[10px]`;

/** スクショ枠の色つき影（黒影を使わない）。AppShot の shadow-card を上書きする。 */
export const SHOT_SHADOW = "shadow-[0_4px_20px_rgba(125,31,117,0.16)]";

/**
 * 見出しは「太さでなく大きさ」で立てる（weight 500・詰め・palt）。
 * `word-break: auto-phrase` は和文を文節で折る（Chrome 119+。非対応ブラウザは無視するだけ）。
 * root の `text-wrap: pretty` は CJK の語境界を知らないため、数詞＋助数詞や動詞が語の途中で
 * 折れる箇所は呼び出し側で `inline-block` の単位に括る（保険）。
 */
export const HEADING =
  "font-medium tracking-[-0.01em] [font-feature-settings:'palt'] [word-break:auto-phrase]";
export const H1 = `text-[length:clamp(34px,calc(18px_+_2.6vw),56px)] leading-[1.2] ${HEADING}`;
export const H2 = `text-[length:clamp(30px,calc(18px_+_2.2vw),46px)] leading-[1.2] [text-wrap:balance] ${HEADING}`;
export const H3 = `text-[22px] leading-[1.4] ${HEADING}`;
export const LEAD =
  "text-[17px] leading-[1.8] text-ink-2 [word-break:auto-phrase]";
/** 本文（カード・停止・図面板）。見出しと同じく文節で折る（語の途中で折れる「土台を作／れる」を避ける・T-M8-421）。 */
export const BODY = "text-sm leading-[1.8] [word-break:auto-phrase]";
export const SUB =
  "mt-4 max-w-[800px] text-[17px] leading-[1.8] text-ink-2 [word-break:auto-phrase]";

/** 主CTA・副CTAは同寸の完全ピル（ヘッダーだけ小さい）。 */
export const PILL_LG = "h-14 rounded-pill px-10 text-base font-bold";
export const PILL_MD = "h-11 rounded-pill px-6 text-sm font-bold";
export const CTA_PRIMARY_HOVER =
  "hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(125,31,117,0.25)] motion-reduce:hover:translate-y-0";

/**
 * 主CTA直下の法令注記（要件06 §1.1）。ヒーロー・画面ツアー直後・最終CTAで同文を反復する。
 * 「初回のみ」「カード登録が必要」「期間中に解約すれば料金はかからない」の3開示を1文で。
 */
export const TRIAL_NOTE =
  "はじめての方は7日間無料。カード登録が必要で、期間中に解約すれば料金はかかりません。";

/**
 * 記法チップ（全セクションで同じ意味）:
 * - 自動＝brand塗り: 人の操作なしに定時・毎時で回る工程（集める・作る・投稿・記録）
 * - AI・押すだけ＝薄紫: 「分析を開始」を押したときだけAIが行う（1日1回・表示専用）
 * - あなた＝白ピル: 人の判断（確認・改善）
 * 分析を「自動」と書かないための第3の記法（PRD §5.6 K-2）。
 */
export const CHIP_AUTO =
  "inline-flex h-5 items-center rounded-pill bg-brand px-2 text-caption font-medium whitespace-nowrap text-white";
export const CHIP_AI =
  "inline-flex h-5 items-center rounded-pill border border-brand bg-brand-subtle px-2 text-caption font-medium whitespace-nowrap text-brand";
export const CHIP_YOU =
  "inline-flex h-5 items-center rounded-pill border border-brand bg-white px-2 text-caption font-medium whitespace-nowrap text-brand";

export type Who = "auto" | "ai" | "you";
export const CHIP_CLASS: Record<Who, string> = {
  auto: CHIP_AUTO,
  ai: CHIP_AI,
  you: CHIP_YOU,
};
// 「AI・押すだけ」は読みにくかったため「ボタン1つ」へ（3周目・運営者の指摘「分かりにくい文言」）。
export const CHIP_LABEL: Record<Who, string> = {
  auto: "自動",
  ai: "ボタン1つ",
  you: "あなた",
};

/** アンカー先はヘッダー（64px）ぶん下げる。 */
export const ANCHOR = "scroll-mt-[76px]";

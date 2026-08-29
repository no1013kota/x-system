import type { ImageProvider } from "./resolve-provider";
import type { Provider } from "./types";

/**
 * AIモデル設定で選べるモデルのカタログ（T-M8-107/109/110）。
 *
 * - **選択肢はここが唯一の正本**。保存時（updateAiPurposeConfigSchema）と解決時
 *   （resolve-provider）の両方がここで検証し、カタログ外の値はenv既定へフォールバックする。
 * - `estimateCredits` は**1回あたりの想定実費（円=クレジット）**。画面の目安表示と
 *   reserve（開始時の仮押さえ）の両方がこの値を使う（T-M8-110で表示と見積もりの正本を統一）。
 *   実際の消費は完了時に実費で精算されるため、これはあくまで目安（要件03 §7）。
 * - 文章は「Webリサーチ込み1回」の想定: 検索固定費（約$0.02〜0.05）＋モデル単価比例部。
 *   実測（2026-08-16の台帳: Fable 5で$0.33≒53円）とトークン単価比から算出。
 *   単純な単価倍数にしない——検索固定費まで倍化して過大になる（旧・倍数方式の誤り）。
 * - 画像は `pricing.ts IMAGE_FLAT_RATES_USD`（1枚あたり概算単価）×160円の切り上げと一致させる。
 * - IDと単価は各社公式ドキュメントで確認（2026-08-15。platform.claude.com /
 *   developers.openai.com/api/docs/pricing / ai.google.dev/gemini-api/docs/pricing）。
 *   **モデルの改廃・価格改定は頻繁**なので、追加・変更時は必ず公式と実測（台帳）で再確認する。
 * - Claude Sonnet 4.6 は掲載しない（Sonnet 5より高単価$3/$15で性能も下＝下位互換。
 *   2026-08-16 運営者判断）。保存済みの選択はカタログ外としてenv既定へフォールバックする。
 */

export interface ModelOption {
  id: string;
  /** 画面表示名（位置づけを添える。内部IDだけを見せない・要件06 §5）。 */
  label: string;
  /** 1回あたりの想定実費（円=クレジット・切り上げ目安）。表示とreserve見積もりの正本。 */
  estimateCredits: number;
}

export const TEXT_MODEL_OPTIONS: Record<Provider, readonly ModelOption[]> = {
  anthropic: [
    { id: "claude-fable-5", label: "Claude Fable 5（最高性能）", estimateCredits: 5_500 },
    { id: "claude-opus-5", label: "Claude Opus 5（高性能）", estimateCredits: 3_000 },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5（バランス）", estimateCredits: 1_600 },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5（低コスト）", estimateCredits: 1_000 },
  ],
  openai: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol（最高性能）", estimateCredits: 3_000 },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra（バランス）", estimateCredits: 1_600 },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna（低コスト）", estimateCredits: 500 },
    { id: "gpt-5.4", label: "GPT-5.4（前世代）", estimateCredits: 1_800 },
    { id: "gpt-5.4-nano", label: "GPT-5.4 nano（前世代・低コスト）", estimateCredits: 500 },
  ],
  google: [
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash（最新）", estimateCredits: 800 },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", estimateCredits: 800 },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", estimateCredits: 1_400 },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro（前世代・高性能）", estimateCredits: 1_400 },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite（低コスト）", estimateCredits: 500 },
  ],
};

export const IMAGE_MODEL_OPTIONS: Record<ImageProvider, readonly ModelOption[]> = {
  openai: [
    { id: "gpt-image-2", label: "GPT Image 2（最高品質）", estimateCredits: 3_040 },
    { id: "gpt-image-1.5", label: "GPT Image 1.5（バランス）", estimateCredits: 1_120 },
    { id: "gpt-image-1-mini", label: "GPT Image 1 mini（低コスト）", estimateCredits: 480 },
  ],
  google: [
    { id: "gemini-3-pro-image", label: "Nano Banana Pro（最高品質・4K）", estimateCredits: 2_400 },
    { id: "gemini-3.1-flash-image", label: "Nano Banana 2（バランス）", estimateCredits: 1_072 },
    { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite（低コスト）", estimateCredits: 320 },
  ],
};

/** 「おまかせ」（モデル未選択＝運営の既定モデル）のreserve見積もり。基準クラスの想定実費。 */
export const TEXT_DEFAULT_ESTIMATE_CREDITS = 1_600;
/** 画像の既定モデルは低コスト帯（gpt-image-1-mini / Nano Banana 2 Lite級）のため控えめに見積もる。 */
export const IMAGE_DEFAULT_ESTIMATE_CREDITS = 1_200;

/** 1回あたりの見積もりクレジット（表示・reserve共通）。未選択・カタログ外は既定値。 */
export function textEstimateCredits(provider: Provider, model: string | null): number {
  if (!model) return TEXT_DEFAULT_ESTIMATE_CREDITS;
  return (
    TEXT_MODEL_OPTIONS[provider]?.find((m) => m.id === model)?.estimateCredits ??
    TEXT_DEFAULT_ESTIMATE_CREDITS
  );
}

export function imageEstimateCredits(provider: ImageProvider, model: string | null): number {
  if (!model) return IMAGE_DEFAULT_ESTIMATE_CREDITS;
  return (
    IMAGE_MODEL_OPTIONS[provider]?.find((m) => m.id === model)?.estimateCredits ??
    IMAGE_DEFAULT_ESTIMATE_CREDITS
  );
}

export function isCatalogTextModel(provider: Provider, model: string): boolean {
  return TEXT_MODEL_OPTIONS[provider]?.some((m) => m.id === model) ?? false;
}

export function isCatalogImageModel(provider: ImageProvider, model: string): boolean {
  return IMAGE_MODEL_OPTIONS[provider]?.some((m) => m.id === model) ?? false;
}

/**
 * 用途別の固定モデル（T-M8-334・運営者の指示 2026-08-27）。
 *
 * **成果物そのものを作る処理は利用者の選択のまま**（投稿生成 GEN・投稿分析レポート SUGGEST）。
 * 裏方の処理まで同じ最高性能モデルで動かすと、品質に一切効かないところで10倍の単価を払う
 * （Fable 5 = 入力$10/出力$50、Haiku 4.5 = $1/$5・100万トークンあたり）。
 *
 * - `mechanical`: 形を整えるだけ（文字数オーバーの短縮・画像プロンプトの作成・アカウント.mdの統合）
 * - `analysis`: 観察して要約する（学習分析 L1/L2）
 *
 * providerごとに同じ役割の型を1つずつ置く。**BYOKの利用者にも同じ表を使う**——
 * 裏方に高いモデルを使う理由は運営でも利用者でも変わらない（利用者の請求も同じだけ下がる）。
 */
export type TextModelPurpose = "mechanical" | "analysis";

export const PURPOSE_TEXT_MODELS: Record<TextModelPurpose, Record<Provider, string>> = {
  mechanical: {
    anthropic: "claude-haiku-4-5",
    openai: "gpt-5.6-luna",
    google: "gemini-3.5-flash-lite",
  },
  analysis: {
    anthropic: "claude-sonnet-5",
    openai: "gpt-5.6-terra",
    google: "gemini-3.7-flash",
  },
};

/**
 * 用途に対応する固定モデルを返す。**カタログに無いものは返さない**——
 * 単価表（`MODEL_RATES`）にも無いモデルを使うと原価台帳が算出不能になる（原則4）。
 */
export function purposeTextModel(purpose: TextModelPurpose, provider: Provider): string | null {
  const model = PURPOSE_TEXT_MODELS[purpose][provider];
  return model && isCatalogTextModel(provider, model) ? model : null;
}

/**
 * 画像モデルの既定（T-M8-334・運営者の指示 2026-08-27）。**環境変数が未設定でもここが効く。**
 *
 * `gpt-image-2`（$0.19/枚）ではなく `gpt-image-1.5`（$0.07/枚）を既定にする——
 * 1枚あたり2.7倍の差があり、既定のまま使う利用者が最も多いため費用への効き方が大きい。
 * **より高い品質が要る人は設定＞AIモデル設定で選び直せる**（選択は常に優先される）。
 * 環境変数（`OPENAI_IMAGE_MODEL` / `GEMINI_IMAGE_MODEL`）を入れればそちらが優先される
 * ——運営が緊急にモデルを替えたいときの逃げ道として残す。
 */
export const DEFAULT_IMAGE_MODELS: Record<ImageProvider, string> = {
  openai: "gpt-image-1.5",
  google: "gemini-3.1-flash-image",
};

/**
 * ニュース取得のモデル既定（T-M8-337・運営者の指示 2026-08-27）。
 *
 * **環境変数 `NEWS_TEXT_MODEL` が未設定でもここが効く**（画像の既定と同じ考え方・原則3）。
 * 検索して要約するタスクなので中間クラスで足りる。実測（2026-08-22・同一分野同一窓で比較）は
 * **Sonnet $0.15〜0.17/回・Haiku $0.09/回**で、1日12回なら月あたり約9,200円と約5,200円の差
 * （検索を5→3回へ減らした分だけ両方とも下がる）。品質を優先して Sonnet を既定にする。
 * 安い方へ振るなら、この行を `mechanical` の表と同じモデルへ差し替えれば足りる。
 */
export const DEFAULT_NEWS_TEXT_MODELS: Record<Provider, string> = PURPOSE_TEXT_MODELS.analysis;

import type { ImageProvider } from "./resolve-provider";
import type { Provider } from "./types";

/**
 * AIモデル設定（旧AI用途）で選べるモデルのカタログ（T-M8-107）。
 *
 * - **選択肢はここが唯一の正本**。保存時（updateAiPurposeConfigSchema）と解決時
 *   （resolve-provider）の両方がここで検証し、カタログ外の値はenv既定へフォールバックする。
 * - IDと単価は各社公式ドキュメントで確認（2026-08-15。platform.claude.com /
 *   developers.openai.com/api/docs/pricing / ai.google.dev/gemini-api/docs/pricing）。
 *   **モデルの改廃は頻繁**なので、追加・削除時は必ず公式で再確認する（CLAUDE.md 外部API方針）。
 * - 単価はモデル別推定原価（pricing.ts の MODEL_RATES）と対で管理する（原則4）。
 */

export interface ModelOption {
  id: string;
  /** 画面表示名（位置づけを添える。内部IDだけを見せない・要件06 §5）。 */
  label: string;
  /** 単価の目安（利用者・運営者がコスト差を選択時に判断できるように出す）。 */
  priceNote: string;
}

export const TEXT_MODEL_OPTIONS: Record<Provider, readonly ModelOption[]> = {
  anthropic: [
    { id: "claude-fable-5", label: "Claude Fable 5（最高性能）", priceNote: "$10/$50 per MTok" },
    { id: "claude-opus-5", label: "Claude Opus 5（高性能）", priceNote: "$5/$25 per MTok" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5（バランス）", priceNote: "$2/$10 per MTok" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6（前世代バランス）", priceNote: "$3/$15 per MTok" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5（低コスト）", priceNote: "$1/$5 per MTok" },
  ],
  openai: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol（最高性能）", priceNote: "$5/$30 per MTok" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra（バランス）", priceNote: "$2/$12 per MTok" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna（低コスト）", priceNote: "$0.2/$1.2 per MTok" },
    { id: "gpt-5.4", label: "GPT-5.4（前世代）", priceNote: "$2.5/$15 per MTok" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 nano（前世代・低コスト）", priceNote: "$0.2/$1.25 per MTok" },
  ],
  google: [
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash（最新）", priceNote: "$0.75/$3.75 per MTok" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", priceNote: "$0.75/$3.75 per MTok" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", priceNote: "$1.5/$9 per MTok" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro（前世代・高性能）", priceNote: "$1.25/$10 per MTok" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite（低コスト）", priceNote: "$0.3/$2.5 per MTok" },
  ],
};

export const IMAGE_MODEL_OPTIONS: Record<ImageProvider, readonly ModelOption[]> = {
  openai: [
    { id: "gpt-image-2", label: "GPT Image 2（最高品質）", priceNote: "出力 $30 per MTok" },
    { id: "gpt-image-1.5", label: "GPT Image 1.5（バランス）", priceNote: "出力 $10 per MTok" },
    { id: "gpt-image-1-mini", label: "GPT Image 1 mini（低コスト）", priceNote: "出力 $8 per MTok" },
  ],
  google: [
    { id: "gemini-3-pro-image", label: "Nano Banana Pro（最高品質・4K）", priceNote: "高品質・高単価" },
    { id: "gemini-3.1-flash-image", label: "Nano Banana 2（バランス）", priceNote: "約$0.067/枚" },
    { id: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite（低コスト）", priceNote: "低単価" },
  ],
};

export function isCatalogTextModel(provider: Provider, model: string): boolean {
  return TEXT_MODEL_OPTIONS[provider]?.some((m) => m.id === model) ?? false;
}

export function isCatalogImageModel(provider: ImageProvider, model: string): boolean {
  return IMAGE_MODEL_OPTIONS[provider]?.some((m) => m.id === model) ?? false;
}

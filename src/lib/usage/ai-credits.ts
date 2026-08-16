import { imageCreditCost, textCreditCost } from "../ai/model-catalog";
import type { ImageProvider } from "../ai/resolve-provider";
import type { Provider } from "../ai/types";

/**
 * AIクレジットの換算（T-M8-109）。**1クレジット = 1円相当**（UIに円換算は出さない）。
 * premiumのAI実行（文章・画像）は月1000クレジットを共有し、**実費ベース**で減る:
 * 開始時にモデル別の見積もりを押さえ（上限チェック）、成功時に実費で精算、失敗時は全額返還。
 *
 * 円換算レートは事業計画の 1ドル=160円（PRD §6.1）。実費は原価台帳と同じ推定原価
 * （usage.estimated_cost_usd_total）から取り、**切り上げ**で運営に不利な丸めをしない。
 */

export const JPY_PER_USD = 160;

/** 実費（USD）→ 消費クレジット。最低1（実行した事実を無料にしない）。 */
export function creditsFromUsd(usd: number): number {
  return Math.max(1, Math.ceil(usd * JPY_PER_USD));
}

/**
 * reserve時の見積もりクレジット。基準モデルの想定実費（文章=約$0.10・Webリサーチ込み最大／
 * 画像=約$0.20・高品質設定）×160円に、モデルのコスト比倍数（model-catalog）を掛ける。
 * **やや過大な見積もりで押さえ、成功時の精算で実費へ戻す**（不足方向より安全）。
 */
export const TEXT_BASE_ESTIMATE_CREDITS = 16;
export const IMAGE_BASE_ESTIMATE_CREDITS = 32;

export function textReserveEstimate(provider: Provider, model: string | null): number {
  return TEXT_BASE_ESTIMATE_CREDITS * textCreditCost(provider, model);
}

export function imageReserveEstimate(provider: ImageProvider, model: string | null): number {
  return IMAGE_BASE_ESTIMATE_CREDITS * imageCreditCost(provider, model);
}

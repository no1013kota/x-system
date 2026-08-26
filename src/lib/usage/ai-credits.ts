import {
  imageEstimateCredits,
  textEstimateCredits,
} from "../ai/model-catalog";
import type { ImageProvider } from "../ai/resolve-provider";
import type { Provider } from "../ai/types";

/**
 * AIクレジットの換算（T-M8-109→T-M8-325）。**1クレジット = 0.01円相当**（UIに円換算は出さない）。
 * premiumのAI実行（文章・画像）は契約期間ごとに100,000クレジットを共有し、**実費ベース**で減る:
 * 開始時にモデル別の見積もり（カタログ`estimateCredits`・表示と同じ値）を押さえ（上限チェック）、
 * 成功時に実費で精算、失敗時は全額返還。
 *
 * 円換算レートは事業計画の 1ドル=160円（PRD §6.1）。実費は原価台帳と同じ推定原価
 * （usage.estimated_cost_usd_total）から取り、**切り上げ**で運営に不利な丸めをしない。
 */

export const JPY_PER_USD = 160;

/** 1円あたりのクレジット数（T-M8-325）。**1クレジット = 0.01円相当**。 */
export const CREDITS_PER_JPY = 100;

/**
 * 実費（USD）→ 消費クレジット。最低1（実行した事実を無料にしない）。
 *
 * **粒度は0.01円**（T-M8-325）。以前は1円単位で切り上げていたため、$0.001 の実行（0.16円）が
 * 1クレジット＝1円として引かれ、**細かい実行ほど割高**だった。100倍の粒度で丸め損が1/100になる。
 */
export function creditsFromUsd(usd: number): number {
  return Math.max(1, Math.ceil(usd * JPY_PER_USD * CREDITS_PER_JPY));
}

/** reserve時の見積もりクレジット。正本はモデルカタログの `estimateCredits`（T-M8-110）。 */
export function textReserveEstimate(provider: Provider, model: string | null): number {
  return textEstimateCredits(provider, model);
}

export function imageReserveEstimate(provider: ImageProvider, model: string | null): number {
  return imageEstimateCredits(provider, model);
}

import type { Provider, ProviderUsage } from "./types";

/**
 * LLM provider callの推定原価算出（要件02 §4.6・要件04 §10, T-M3-03）。token・キャッシュ・Web検索の
 * 実行時単価から `estimated_cost_usd` を見積もる純粋関数。原価台帳（external_api_usage_events）と
 * `generation_jobs.usage` の推定原価に用いる。
 *
 * 注意: 単価は各社公式の目安（USD）。価格は変動が頻繁なため、価格改定時にここを更新する
 * （CLAUDE.md 外部API方針）。あくまで「推定」原価であり、正確な請求額は各providerの明細を正とする。
 */

export interface ProviderRates {
  /** 入力トークン単価（USD / 100万トークン）。 */
  inputPerMTok: number;
  /** 出力トークン単価（USD / 100万トークン）。 */
  outputPerMTok: number;
  /** プロンプトキャッシュ書き込み単価（USD / 100万トークン）。 */
  cacheWritePerMTok: number;
  /** プロンプトキャッシュ読み出し単価（USD / 100万トークン）。 */
  cacheReadPerMTok: number;
  /** Web検索1回あたり単価（USD）。 */
  webSearchPerCall: number;
}

/** provider別の目安単価（2026-07時点の概算・要定期確認）。 */
export const PROVIDER_RATES: Record<Provider, ProviderRates> = {
  anthropic: {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
    webSearchPerCall: 0.01,
  },
  openai: {
    inputPerMTok: 2.5,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 1.25,
    webSearchPerCall: 0.01,
  },
  google: {
    inputPerMTok: 1.25,
    outputPerMTok: 5,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.3125,
    webSearchPerCall: 0.035,
  },
};

/** numeric(12,6) へ収めるため小数6桁へ丸める。 */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * 正規化済み usage から provider call の推定原価（USD）を見積もる。未知providerは0。
 */
export function estimateProviderCost(
  provider: Provider,
  usage: ProviderUsage,
): number {
  const rates = PROVIDER_RATES[provider];
  if (!rates) return 0;
  const tokenCost =
    (usage.inputTokens * rates.inputPerMTok +
      usage.outputTokens * rates.outputPerMTok +
      usage.cacheCreationInputTokens * rates.cacheWritePerMTok +
      usage.cacheReadInputTokens * rates.cacheReadPerMTok) /
    1_000_000;
  const searchCost = usage.webSearchRequests * rates.webSearchPerCall;
  return round6(tokenCost + searchCost);
}

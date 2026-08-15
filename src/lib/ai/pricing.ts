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

/**
 * モデル別の単価上書き（T-M8-107・原則4）。モデル選択の導入でprovider一律だと
 * 実費と大きくずれる（例: Claude Fable 5 $10/$50 と Haiku 4.5 $1/$5 で10倍）。
 * カタログ（model-catalog.ts）のモデルはここへ対で登録する。無いモデルはprovider既定へフォールバック。
 * 単価の出典: 各社公式pricing（2026-08-15確認）。cacheはAnthropic=書込1.25×入力/読出0.1×入力、
 * OpenAI=読出のみ公式のcached input（書込は入力と同額扱い）、Geminiはprovider既定のまま。
 */
const MODEL_RATES: Record<string, Partial<ProviderRates>> = {
  // Anthropic
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50, cacheWritePerMTok: 12.5, cacheReadPerMTok: 1 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  // OpenAI
  "gpt-5.6-sol": { inputPerMTok: 5, outputPerMTok: 30, cacheWritePerMTok: 5, cacheReadPerMTok: 0.5 },
  "gpt-5.6-terra": { inputPerMTok: 2, outputPerMTok: 12, cacheWritePerMTok: 2, cacheReadPerMTok: 0.2 },
  "gpt-5.6-luna": { inputPerMTok: 0.2, outputPerMTok: 1.2, cacheWritePerMTok: 0.2, cacheReadPerMTok: 0.02 },
  "gpt-5.4": { inputPerMTok: 2.5, outputPerMTok: 15, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.25 },
  "gpt-5.4-nano": { inputPerMTok: 0.2, outputPerMTok: 1.25, cacheWritePerMTok: 0.2, cacheReadPerMTok: 0.02 },
  // Google（text。cacheはprovider既定）
  "gemini-3.7-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "gemini-3.6-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "gemini-3.5-flash": { inputPerMTok: 1.5, outputPerMTok: 9 },
  "gemini-3.5-flash-lite": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
};

/** numeric(12,6) へ収めるため小数6桁へ丸める。 */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * 正規化済み usage から provider call の推定原価（USD）を見積もる。単価表を持たない provider は
 * 算出不能として null を返す（原価台帳の unit_cost_usd/estimated_cost_usd は null で記録・要件02 §3.17）。
 */
export function estimateProviderCost(
  provider: Provider,
  usage: ProviderUsage,
  /** 実行に使ったモデル。MODEL_RATESにあればモデル別単価を使う（無ければprovider既定）。 */
  model?: string,
): number | null {
  const base = PROVIDER_RATES[provider];
  if (!base) return null;
  const rates: ProviderRates = { ...base, ...(model ? MODEL_RATES[model] : undefined) };
  const tokenCost =
    (usage.inputTokens * rates.inputPerMTok +
      usage.outputTokens * rates.outputPerMTok +
      usage.cacheCreationInputTokens * rates.cacheWritePerMTok +
      usage.cacheReadInputTokens * rates.cacheReadPerMTok) /
    1_000_000;
  const searchCost = usage.webSearchRequests * rates.webSearchPerCall;
  return round6(tokenCost + searchCost);
}

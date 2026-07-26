import type { Provider, TextGenResult } from "./types";
// `ProviderCall` は検証スキーマ（usage-schema.ts）を正本に z.infer で導出する。
// 従来どおり本モジュールからも型を参照・re-export できるようにする。
import type { ProviderCall } from "./usage-schema";

export type { ProviderCall } from "./usage-schema";

/**
 * 3プロバイダ共通のusage正規化（要件02 §4.6 `generation_jobs.usage.calls` 要素）と
 * 起動時のprovider機能検証（要件01 §7）。全アダプタの `TextGenResult` を同一の
 * `ProviderCall` 型へ変換し、原価台帳・usage保存の入力を1本化する。
 */

export interface ProviderCallMeta {
  model: string;
  operation: string;
  latencyMs: number;
  status?: "succeeded" | "failed";
  errorCode?: string | null;
  /** 推定原価（USD）。単価表がなく算出不能なら null。 */
  estimatedCostUsd?: number | null;
}

/**
 * どのプロバイダの `TextGenResult` も同一の `ProviderCall` へ正規化する（§5.1）。
 * cache_hitはcache read tokenの有無、web_search_countは正規化済みusageから取る。
 */
export function toProviderCall(
  result: TextGenResult,
  meta: ProviderCallMeta,
): ProviderCall {
  const u = result.usage;
  return {
    provider: result.provider,
    model: meta.model,
    operation: meta.operation,
    request_id: result.requestId,
    status: meta.status ?? "succeeded",
    stop_reason: result.stopReason,
    latency_ms: meta.latencyMs,
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    web_search_count: u.webSearchRequests,
    cache_hit: u.cacheReadInputTokens > 0,
    citations: result.citations,
    error_code: meta.errorCode ?? null,
    estimated_cost_usd: meta.estimatedCostUsd ?? null,
  };
}

/**
 * provider callが例外で終わった場合の `ProviderCall`（D-4 案A・要件04 §10「成功・失敗を問わず記録」）。
 * SDKはthrow時にusageを返さないことが多いため、記録できるのは発生事実・request ID・error codeに限る。
 * トークン数は0とし、原価は算出不能として null にする。
 */
export function failedProviderCall(meta: {
  provider: Provider;
  model: string;
  operation: string;
  latencyMs: number;
  requestId?: string | null;
  errorCode?: string | null;
}): ProviderCall {
  return {
    provider: meta.provider,
    model: meta.model,
    operation: meta.operation,
    request_id: meta.requestId ?? null,
    status: "failed",
    stop_reason: null,
    latency_ms: meta.latencyMs,
    input_tokens: 0,
    output_tokens: 0,
    web_search_count: 0,
    cache_hit: false,
    citations: [],
    error_code: meta.errorCode ?? null,
    estimated_cost_usd: null,
  };
}

/**
 * 検索と構造化出力の併用可否（モデル別・起動時検証用, §5.1/要件01 §7）。
 * 併用可のモデルだけを許可リストに載せ、既定は false（＝JSON出力指示＋コード検証へフォールバック）。
 * 実装時に各社公式ドキュメントで対応可否を確認して更新する。
 */
const SEARCH_WITH_STRUCTURED_OUTPUT: Record<Provider, Set<string>> = {
  anthropic: new Set(),
  openai: new Set(),
  google: new Set(),
};

export function canCombineSearchAndStructuredOutput(
  provider: Provider,
  model: string,
): boolean {
  return SEARCH_WITH_STRUCTURED_OUTPUT[provider]?.has(model) ?? false;
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

/**
 * 起動時のprovider設定検証（要件01 §7）。APIキー・モデルが無ければ throw する
 * （無効なら別providerへ暗黙に切り替えない）。呼び出し側が選択providerに対して実行する。
 */
export function verifyTextProvider(cfg: {
  provider: Provider;
  apiKey?: string;
  model?: string;
}): void {
  if (!cfg.apiKey) {
    throw new ProviderConfigError(`${cfg.provider}: API key is not configured`);
  }
  if (!cfg.model) {
    throw new ProviderConfigError(`${cfg.provider}: model is not configured`);
  }
}

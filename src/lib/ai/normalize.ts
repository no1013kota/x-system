import type { Citation, Provider, TextGenResult } from "./types";

/**
 * 3プロバイダ共通のusage正規化（要件02 §4.6 `generation_jobs.usage.calls` 要素）と
 * 起動時のprovider機能検証（要件01 §7）。全アダプタの `TextGenResult` を同一の
 * `ProviderCall` 型へ変換し、原価台帳・usage保存の入力を1本化する。
 */

/** 要件02 §4.6 の calls 配列要素。 */
export interface ProviderCall {
  provider: Provider;
  model: string;
  operation: string;
  request_id: string | null;
  status: "succeeded" | "failed";
  stop_reason: string | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  web_search_count: number;
  cache_hit: boolean;
  citations: Citation[];
  error_code: string | null;
  /** 推定原価（USD）。単価表がなく算出不能な場合は null（要件02 §3.17）。 */
  estimated_cost_usd: number | null;
}

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

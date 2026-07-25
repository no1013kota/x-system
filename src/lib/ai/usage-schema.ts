import { z } from "zod";

/**
 * `generation_jobs.usage` のzodスキーマ（要件02 §4.6）。全provider callを共通形式へ
 * 正規化した `ProviderCall` の配列＋総原価。保存前の検証・テストの契約確認に使う。
 */

export const citationSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
});

export const providerCallSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  model: z.string(),
  operation: z.string(),
  request_id: z.string().nullable(),
  status: z.enum(["succeeded", "failed"]),
  stop_reason: z.string().nullable(),
  latency_ms: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  web_search_count: z.number(),
  cache_hit: z.boolean(),
  citations: z.array(citationSchema),
  error_code: z.string().nullable(),
  estimated_cost_usd: z.number().nullable(),
});

export const generationUsageSchema = z.object({
  calls: z.array(providerCallSchema),
  estimated_cost_usd_total: z.number(),
});

export type GenerationUsage = z.infer<typeof generationUsageSchema>;

/**
 * 正規化済み provider call（要件02 §4.6 `generation_jobs.usage.calls` 要素）。
 * `providerCallSchema` を単一の正本とし、TS型はここから `z.infer` で導出する
 * （手書きの型と検証スキーマの二重定義＝ドリフトを防ぐ）。`provider` は文章3社
 * （anthropic/openai/google）で、原価台帳側の `ApiProvider`（'x' を含む）とは別。
 */
export type ProviderCall = z.infer<typeof providerCallSchema>;

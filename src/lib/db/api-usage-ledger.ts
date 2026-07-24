import type { ProviderCall } from "../ai/normalize";
import type { Queryable } from "../x/token-refresh";

/**
 * 原価台帳 external_api_usage_events への冪等記録（要件02 §3.17・要件04 §10, T-M3-03）。
 * provider call（LLM/X API）1回=1イベント。成功・失敗を問わず記録できる。`idempotency_key` の
 * unique制約でリトライ・重複起動でも二重計上しない。service-role（pool）から実行する。
 */

export interface ExternalApiUsageInput {
  userId: string;
  xAccountId?: string | null;
  jobId?: string | null;
  /** api_provider enum: 'x' | 'anthropic' | 'openai' | 'google'。 */
  provider: string;
  /** operation CHECK: text_generation / web_search / image_generation / x_post_* / x_user_read。 */
  operation: string;
  requestId?: string | null;
  status: "succeeded" | "failed";
  httpStatus?: number | null;
  errorCode?: string | null;
  quantity?: number;
  /** 監査用の呼び出しusage（jsonb）。 */
  usage?: unknown;
  unitCostUsd: number;
  estimatedCostUsd: number;
  /** 冪等キー（例: `${jobId}:${provider}:${callSeq}` や request_id 由来）。 */
  idempotencyKey: string;
}

/**
 * イベントを1件記録する。`idempotency_key` 重複時は何もしない。新規挿入できたら true。
 */
export async function recordExternalApiUsage(
  db: Queryable,
  input: ExternalApiUsageInput,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into external_api_usage_events
       (user_id, x_account_id, job_id, provider, operation, request_id, status,
        http_status, error_code, quantity, usage, unit_cost_usd, estimated_cost_usd,
        idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
     on conflict (idempotency_key) do nothing`,
    [
      input.userId,
      input.xAccountId ?? null,
      input.jobId ?? null,
      input.provider,
      input.operation,
      input.requestId ?? null,
      input.status,
      input.httpStatus ?? null,
      input.errorCode ?? null,
      input.quantity ?? 1,
      JSON.stringify(input.usage ?? {}),
      input.unitCostUsd,
      input.estimatedCostUsd,
      input.idempotencyKey,
    ],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * 正規化済み ProviderCall を原価台帳イベント入力へ変換する（LLM系）。quantity=1、単価=推定原価。
 * 冪等キーは呼び出し側（worker）が job と call 連番から決める。
 */
export function providerCallToUsageEvent(
  call: ProviderCall,
  ctx: {
    userId: string;
    xAccountId?: string | null;
    jobId?: string | null;
    idempotencyKey: string;
  },
): ExternalApiUsageInput {
  return {
    userId: ctx.userId,
    xAccountId: ctx.xAccountId ?? null,
    jobId: ctx.jobId ?? null,
    provider: call.provider,
    operation: call.operation,
    requestId: call.request_id,
    status: call.status,
    errorCode: call.error_code,
    quantity: 1,
    usage: call,
    unitCostUsd: call.estimated_cost_usd,
    estimatedCostUsd: call.estimated_cost_usd,
    idempotencyKey: ctx.idempotencyKey,
  };
}

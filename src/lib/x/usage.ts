import { recordExternalApiUsage } from "../db/api-usage-ledger";
import type { Queryable } from "./token-refresh";
import { XApiError, type XApiMeta } from "./client";
import type { XCostOperation } from "./pricing";

/**
 * X API 呼び出しの原価台帳記録ラッパ（要件04 §10, 要件02 §3.17, T-M3-17）。
 * create / delete / read（x_post_*・x_user_read）を成功・失敗を問わず
 * `external_api_usage_events` へ冪等記録する（`idempotencyKey` unique で二重計上しない）。
 *
 * - dry_run（実 API を呼ばず実 tweet_id / 利用枠を作らない）は原価が発生しないため記録しない。
 * - media upload は原価台帳から除外するため、本ラッパで包まない（運用logのみ）。
 * - 台帳記録の失敗で API 結果を握り潰さない（記録は best-effort）。
 */

export interface XUsageContext {
  userId: string;
  xAccountId?: string | null;
  jobId?: string | null;
}

export interface RecordedXCallParams {
  ctx: XUsageContext;
  operation: XCostOperation;
  /** 呼び出し側が xUnitCost() で算出した実行時単価。 */
  unitCostUsd: number;
  /** 冪等キー（例: `draft:{draft_id}:tweet:{seq}:x_post_create`）。 */
  idempotencyKey: string;
}

export async function recordedXCall<T extends XApiMeta>(
  db: Queryable,
  params: RecordedXCallParams,
  call: () => Promise<T>,
): Promise<T> {
  const { ctx, operation, unitCostUsd, idempotencyKey } = params;
  let result: T;
  try {
    result = await call();
  } catch (error) {
    const xerr = error instanceof XApiError ? error : null;
    // 失敗も記録する（resource は作られないため estimated_cost は 0、単価は監査用に残す）。
    await recordExternalApiUsage(db, {
      userId: ctx.userId,
      xAccountId: ctx.xAccountId ?? null,
      jobId: ctx.jobId ?? null,
      provider: "x",
      operation,
      requestId: null,
      status: "failed",
      httpStatus: xerr?.status ?? null,
      errorCode: xerr?.errorCode ?? null,
      quantity: 1,
      unitCostUsd,
      estimatedCostUsd: 0,
      idempotencyKey,
    }).catch(() => {});
    throw error;
  }

  // dry_run は実コストが無いため台帳に記録しない（要件04 §10）。
  if (!result.dryRun) {
    const quantity = Math.max(1, result.quantity);
    await recordExternalApiUsage(db, {
      userId: ctx.userId,
      xAccountId: ctx.xAccountId ?? null,
      jobId: ctx.jobId ?? null,
      provider: "x",
      operation,
      requestId: result.requestId,
      status: "succeeded",
      quantity,
      unitCostUsd,
      estimatedCostUsd: unitCostUsd * quantity,
      idempotencyKey,
    }).catch(() => {});
  }
  return result;
}

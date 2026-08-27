import type { NewsCategory } from "@/lib/news";

import type { BatchResult } from "../ai/anthropic-batch";
import type { Queryable } from "../db/queryable";

/**
 * ニュース取得のBatch実行（T-M8-338・運営者の指示 2026-08-27）。
 *
 * 定時（JST 12時・19時）に6分野を**まとめて投げる**だけで終わり、結果は20分おきの
 * 取り込みcronが拾う。トークンが半額になる代わりに、結果がその場では返らない。
 *
 * **「投げた」と「取り込んだ」の間を表で持つ**（`news_batches`）。同期実行なら成否は
 * その場で決まるが、非同期では「AI側で処理中」「24時間で失効した」という中間状態が生まれる。
 * 行として残さないと、運営者から見て「ニュースが来ない」理由が分からなくなる（原則1・原則2）。
 */

/** 24時間で失効する（公式仕様）。これを過ぎたバッチは待たずに諦めて次の回へ委ねる。 */
export const BATCH_EXPIRY_HOURS = 24;

export interface NewsBatchRow {
  id: string;
  provider_batch_id: string;
  window_key: string;
  categories: string[];
  /** 投げたときの取得窓（時間）。取り込みで計算し直さない。 */
  lookback_hours: number;
  /** 投げたときのモデル。原価台帳の単価はこれで決まる。 */
  model: string;
  submitted_at: string;
}

/** 投げたバッチを記録する。**同じ時間窓に2つ作らない**（`window_key` が unique）。 */
export async function recordNewsBatch(
  db: Queryable,
  params: {
    providerBatchId: string;
    windowKey: string;
    categories: readonly NewsCategory[];
    lookbackHours: number;
    model: string;
  },
): Promise<boolean> {
  const res = await db.query(
    `insert into news_batches (provider_batch_id, window_key, categories, lookback_hours, model)
     values ($1, $2, $3, $4, $5)
     on conflict do nothing`,
    [
      params.providerBatchId,
      params.windowKey,
      [...params.categories],
      params.lookbackHours,
      params.model,
    ],
  );
  return (res.rowCount ?? 0) === 1;
}

/** 取り込み待ちのバッチを古い順に返す。 */
export async function pendingNewsBatches(db: Queryable, limit = 5): Promise<NewsBatchRow[]> {
  const { rows } = await db.query<NewsBatchRow>(
    `select id, provider_batch_id, window_key, categories, lookback_hours, model,
            submitted_at::text as submitted_at
       from news_batches
      where status = 'pending'
      order by submitted_at
      limit $1`,
    [limit],
  );
  return rows;
}

export async function markNewsBatch(
  db: Queryable,
  params: { id: string; status: "collected" | "expired" | "failed"; errorCode?: string | null },
): Promise<void> {
  await db.query(
    `update news_batches
        set status = $2, collected_at = now(), error_code = $3
      where id = $1`,
    [params.id, params.status, params.errorCode ?? null],
  );
}

/** 投げてから何時間経ったか（失効の判定に使う）。 */
export function hoursSinceSubmit(submittedAt: string, now: Date): number {
  const at = Date.parse(submittedAt);
  if (Number.isNaN(at)) return 0;
  return (now.getTime() - at) / 3_600_000;
}

/**
 * 取り込み結果の1分野ぶん。**「成功して0件」と「失敗して0件」を別の形で表す**（原則1）。
 * `ok=false` は取りに行けなかった側（errored/expired/読めない応答）で、
 * `ok=true` かつ `items` が空なら「該当ニュースが無かった」。
 */
export interface CollectedCategory {
  category: NewsCategory;
  ok: boolean;
  text: string | null;
  errorCode: string | null;
  usage: BatchResult["usage"];
}

/**
 * バッチ結果を分野ごとに整理する。**返ってこなかった分野も失敗として並べる**——
 * 黙って欠けると「該当なし」と区別が付かない。
 */
export function organizeBatchResults(
  categories: readonly NewsCategory[],
  results: readonly BatchResult[],
): CollectedCategory[] {
  const byId = new Map(results.map((r) => [r.custom_id, r]));
  return categories.map((category) => {
    const result = byId.get(category);
    if (!result) {
      return { category, ok: false, text: null, errorCode: "missing_result", usage: null };
    }
    if (result.type !== "succeeded" || !result.text) {
      return {
        category,
        ok: false,
        text: null,
        errorCode: result.errorCode ?? result.type,
        usage: result.usage,
      };
    }
    return { category, ok: true, text: result.text, errorCode: null, usage: result.usage };
  });
}

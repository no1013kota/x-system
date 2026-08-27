import "server-only";

import {
  createMessageBatch,
  fetchMessageBatchResults,
  getMessageBatch,
  type BatchRequest,
} from "../ai/anthropic-batch";
import { buildAnthropicParams, DEFAULT_MAX_TOKENS, DEFAULT_WEB_SEARCH_TOOL_TYPE } from "../ai/anthropic";
import { recordProviderCalls } from "../db/api-usage-ledger";
import { estimateProviderCost } from "../ai/pricing";
import { pooledQueryable } from "../db/pool";
import { env } from "../env";
import { NEWS_FETCH_CATEGORIES, type NewsCategory } from "../news";
import { parseAndValidate } from "../ai/parse";
import { collectNewsBatch } from "./news-fetch";
import {
  BATCH_EXPIRY_HOURS,
  hoursSinceSubmit,
  markNewsBatch,
  organizeBatchResults,
  pendingNewsBatches,
  recordNewsBatch,
} from "./news-batch";
import { buildNewsRequest, newsEnvelopeSchema } from "./news-research";

/**
 * ニュース取得のBatch配線（T-M8-338・運営者の指示 2026-08-27）。
 *
 * **投げる（定時cron）と取り込む（20分おきのcron）を分ける。** トークンが半額になる代わりに
 * 結果は非同期で返るため、同じ起動の中で完結しない。
 *
 * providerはAnthropic固定——Batch APIを持つのがAnthropicだけで、ニュースは運営キーで動く
 * （`NEWS_TEXT_PROVIDER` が別providerのときはBatchを使わず同期実行へ落とす）。
 */

const pooledDb = pooledQueryable();

/** Batchのトークン単価は通常の50%（公式ドキュメント 2026-08-27 確認）。検索料は対象外。 */
const BATCH_TOKEN_DISCOUNT = 0.5;

/** Batchを使える条件。使えないときは呼び出し側が同期実行へ落とす。 */
export function newsBatchAvailable(): boolean {
  return env.NEWS_TEXT_PROVIDER === "anthropic" && Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * 6分野を1つのバッチとして投げる。**同じ時間窓に2つ作らない**（`window_key` unique）。
 * 戻り値は provider 側のバッチID（作れなかったときは null）。
 */
export async function submitNewsBatch(params: {
  windowKey: string;
  now: Date;
  model: string;
  categories?: readonly NewsCategory[];
  webSearchMaxUses?: number;
}): Promise<{ batchId: string; categories: NewsCategory[]; lookbackHours: number } | null> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const categories = params.categories ?? NEWS_FETCH_CATEGORIES;

  const requests: BatchRequest[] = [];
  let lookbackHours = 0;
  for (const category of categories) {
    const built = await buildNewsRequest(category, {
      db: pooledDb,
      clock: params.now,
      webSearchMaxUses: params.webSearchMaxUses,
    });
    lookbackHours = built.hours;
    requests.push({
      // custom_id は分野名そのもの（`^[a-zA-Z0-9_-]{1,64}$` を満たす）。結果の突き合わせに使う。
      custom_id: category,
      params: buildAnthropicParams(
        {
          system: [built.system],
          user: built.user,
          webSearch: { maxUses: built.webSearchMaxUses },
          // Batchにタイムアウトは無い（接続を保たない）。同期実行と同じ形にするためだけの値。
          timeoutMs: 0,
        },
        [{ role: "user", content: built.user }],
        {
          model: params.model,
          webSearchToolType: DEFAULT_WEB_SEARCH_TOOL_TYPE,
          maxTokens: DEFAULT_MAX_TOKENS,
        },
      ),
    });
  }

  const batchId = await createMessageBatch(apiKey, requests);
  const recorded = await recordNewsBatch(pooledDb, {
    providerBatchId: batchId,
    windowKey: params.windowKey,
    categories,
    lookbackHours,
    model: params.model,
  });
  // 既に同じ窓のバッチがあった（＝重複起動）。投げてしまった分は放置されるが、
  // 24時間で失効し課金もされない。**行を作らない方**を選ぶ（1窓2バッチの取り込みを作らない）。
  if (!recorded) return null;
  return { batchId, categories: [...categories], lookbackHours };
}

export interface NewsBatchCollectSummary {
  checked: number;
  collected: number;
  expired: number;
  stillRunning: number;
  savedTotal: number;
}

/**
 * 取り込み待ちのバッチを見に行き、終わっていれば保存する。
 *
 * **24時間を過ぎたものは失効として畳む**——待ち続けても返らないうえ、
 * `pending` のまま残ると「いま動いているのか止まっているのか」が分からなくなる（原則1）。
 */
export async function collectNewsBatches(now: Date): Promise<NewsBatchCollectSummary> {
  const apiKey = env.ANTHROPIC_API_KEY;
  const summary: NewsBatchCollectSummary = {
    checked: 0,
    collected: 0,
    expired: 0,
    stillRunning: 0,
    savedTotal: 0,
  };
  if (!apiKey) return summary;

  for (const batch of await pendingNewsBatches(pooledDb)) {
    summary.checked += 1;
    let status;
    try {
      status = await getMessageBatch(apiKey, batch.provider_batch_id);
      // 1件の失敗で他のバッチの取り込みを止めない（次の20分でまた見に行く）。
    } catch (error) {
      console.error(`[news_batch] status ${batch.provider_batch_id}`, error);
      if (hoursSinceSubmit(batch.submitted_at, now) > BATCH_EXPIRY_HOURS) {
        await markNewsBatch(pooledDb, { id: batch.id, status: "failed", errorCode: "status_error" });
      }
      continue;
    }

    if (status.processing_status !== "ended" || !status.results_url) {
      if (hoursSinceSubmit(batch.submitted_at, now) > BATCH_EXPIRY_HOURS) {
        // 公式仕様の期限。ここを過ぎたら返らない（課金もされない）。
        await markNewsBatch(pooledDb, { id: batch.id, status: "expired", errorCode: "expired" });
        summary.expired += 1;
      } else {
        summary.stillRunning += 1;
      }
      continue;
    }

    const results = await fetchMessageBatchResults(apiKey, status.results_url);
    const organized = organizeBatchResults(batch.categories as NewsCategory[], results);

    /*
      原価台帳へ記録する（要件02 §3.17）。**Batchの単価は半額**なので、
      同期実行と同じ見積もりのまま入れると実費の2倍で記録され、費用の把握が狂う（原則4）。
      検索料（1回$0.01）は割引の対象と書かれていないため、トークン分だけを半額にする。
    */
    await recordProviderCalls(
      pooledDb,
      organized
        .filter((entry) => entry.usage)
        .map((entry) => {
          const usage = {
            inputTokens: entry.usage?.input_tokens ?? 0,
            outputTokens: entry.usage?.output_tokens ?? 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            webSearchRequests: entry.usage?.web_search_requests ?? 0,
            providerCalls: 1,
          };
          const tokensOnly = estimateProviderCost(
            "anthropic",
            { ...usage, webSearchRequests: 0 },
            batch.model,
          );
          const searchOnly = estimateProviderCost(
            "anthropic",
            { ...usage, inputTokens: 0, outputTokens: 0 },
            batch.model,
          );
          return {
            provider: "anthropic" as const,
            model: batch.model,
            operation: "text_generation",
            request_id: null,
            status: entry.ok ? ("succeeded" as const) : ("failed" as const),
            stop_reason: null,
            latency_ms: 0,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            web_search_count: usage.webSearchRequests,
            cache_hit: false,
            citations: [],
            error_code: entry.errorCode,
            estimated_cost_usd:
              tokensOnly === null || searchOnly === null
                ? null
                : Math.round((tokensOnly * BATCH_TOKEN_DISCOUNT + searchOnly) * 1_000_000) /
                  1_000_000,
          };
        }),
      { userId: null, keyPrefix: `news:${batch.window_key}:batch` },
    );

    const fetched = await collectNewsBatch({
      db: pooledDb,
      windowKey: batch.window_key,
      submittedAt: new Date(batch.submitted_at),
      lookbackHours: batch.lookback_hours,
      collected: organized,
      parseEnvelope: (text) => {
        const parsed = parseAndValidate(text, newsEnvelopeSchema);
        return parsed.ok
          ? { ok: true, items: parsed.value.items }
          : { ok: false, reason: text.slice(0, 2000) };
      },
    });
    await markNewsBatch(pooledDb, { id: batch.id, status: "collected" });
    summary.collected += 1;
    summary.savedTotal += fetched.totalSaved;
  }
  return summary;
}

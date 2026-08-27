import type { RawCreateParams } from "./anthropic";

/**
 * Message Batches API の薄い契約（T-M8-338・公式ドキュメント 2026-08-27 確認）。
 *
 * **トークンが半額**になる代わりに、結果は同期では返らない。投げる→（別の起動で）取りに行く。
 * ほとんどのバッチは1時間以内に終わり、**24時間で失効**する（失効分は課金されない）。
 * Web検索を含むサーバーツールもバッチ内で動く（組織単位で流量制限され、多いと時間がかかる）。
 *
 * SDKに依存しないHTTPだけで書く——ニュース取得しか使わない小さな面なので、
 * SDKのversion差でここが壊れる方が損（`fetch` は Node の標準）。
 */

const API_BASE = "https://api.anthropic.com/v1/messages/batches";
const API_VERSION = "2023-06-01";

/** 1件のリクエスト。`custom_id` で結果を突き合わせる（英数字・ハイフン・アンダースコアのみ）。 */
export interface BatchRequest {
  custom_id: string;
  params: RawCreateParams;
}

export interface BatchStatus {
  id: string;
  /** `in_progress` → `ended`。`ended` になって初めて結果を取りに行ける。 */
  processing_status: string;
  /** `ended` のときだけ入る。JSONLの取得先。 */
  results_url: string | null;
}

/** 1件ぶんの結果。`succeeded` 以外は本文が無い（課金もされない）。 */
export interface BatchResult {
  custom_id: string;
  /** `succeeded` / `errored` / `canceled` / `expired` */
  type: string;
  /** `succeeded` のときの応答本文（テキストブロックの連結）。 */
  text: string | null;
  /** 応答のusage（原価台帳へ入れる）。 */
  usage: {
    input_tokens: number;
    output_tokens: number;
    web_search_requests: number;
  } | null;
  errorCode: string | null;
}

interface RawResultLine {
  custom_id?: string;
  result?: {
    type?: string;
    message?: {
      content?: { type?: string; text?: string }[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        server_tool_use?: { web_search_requests?: number };
      };
    };
    error?: { type?: string; error?: { type?: string } };
  };
}

function headers(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    "content-type": "application/json",
  };
}

async function assertOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  // **本文をそのまま投げない**（要件01 §8）。呼び出し側が記録する短い識別子だけにする。
  throw new Error(`anthropic batch ${what} failed: HTTP ${res.status}`);
}

/** バッチを作る。返り値は provider 側のバッチID。 */
export async function createMessageBatch(
  apiKey: string,
  requests: BatchRequest[],
): Promise<string> {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ requests }),
  });
  await assertOk(res, "create");
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error("anthropic batch create returned no id");
  return body.id;
}

/** バッチの状態を見る。 */
export async function getMessageBatch(apiKey: string, batchId: string): Promise<BatchStatus> {
  const res = await fetch(`${API_BASE}/${batchId}`, { headers: headers(apiKey) });
  await assertOk(res, "get");
  const body = (await res.json()) as {
    id: string;
    processing_status?: string;
    results_url?: string | null;
  };
  return {
    id: body.id,
    processing_status: body.processing_status ?? "in_progress",
    results_url: body.results_url ?? null,
  };
}

/**
 * 結果（JSONL）を取り込む。**行ごとに独立**しているので、1件壊れていても他は使える。
 * 読めなかった行は落として続ける——1行のせいで6分野ぶんを捨てる方が損。
 */
export async function fetchMessageBatchResults(
  apiKey: string,
  resultsUrl: string,
): Promise<BatchResult[]> {
  const res = await fetch(resultsUrl, { headers: headers(apiKey) });
  await assertOk(res, "results");
  const body = await res.text();
  const out: BatchResult[] = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let parsed: RawResultLine;
    try {
      parsed = JSON.parse(line) as RawResultLine;
      // eslint-disable-next-line no-restricted-syntax -- 1行の破損で全体を捨てない（他分野は使える）
    } catch {
      continue;
    }
    if (!parsed.custom_id || !parsed.result) continue;
    const message = parsed.result.message;
    const text =
      message?.content
        ?.filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("") ?? null;
    out.push({
      custom_id: parsed.custom_id,
      type: parsed.result.type ?? "errored",
      text: text && text.length > 0 ? text : null,
      usage: message?.usage
        ? {
            input_tokens: message.usage.input_tokens ?? 0,
            output_tokens: message.usage.output_tokens ?? 0,
            web_search_requests: message.usage.server_tool_use?.web_search_requests ?? 0,
          }
        : null,
      errorCode: parsed.result.error?.error?.type ?? parsed.result.error?.type ?? null,
    });
  }
  return out;
}

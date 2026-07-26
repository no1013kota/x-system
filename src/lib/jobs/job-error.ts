import { MAX_ATTEMPTS, backoffMs, isRetryable, type ErrorKind } from "./retry";

/**
 * handlerが投げた例外を要件04 §5の再試行ポリシーへ写像する（D-5 中央finalizer）。
 * 各handlerが個別に差し戻しを実装すると重複するため、分類と判断はここに集約する。
 * provider固有の型に依存せず、外形（`kind`／`status`／`retryable`／network系code）で判定する。
 */

/** 接続断・タイムアウトを表す代表的な Node/undici の code。 */
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const KNOWN_KINDS = new Set<ErrorKind>([
  "rate_limit",
  "server",
  "network",
  "auth",
  "invalid",
  "unknown",
]);

function prop(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

/** HTTP status → 種別（要件04 §5。X clientの分類と同じ規則）。 */
function fromStatus(status: number): ErrorKind {
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status === 401 || status === 403) return "auth";
  return "invalid";
}

/**
 * 例外を ErrorKind へ分類する。判定順は「明示の kind → 明示の retryable → HTTP status →
 * network code → 名前」。判断材料が無ければ `unknown`（＝再試行しない）。
 */
export function classifyJobError(error: unknown): ErrorKind {
  const kind = prop(error, "kind");
  if (typeof kind === "string" && KNOWN_KINDS.has(kind as ErrorKind)) {
    return kind as ErrorKind;
  }
  // PauseTurnIncompleteError など、自前で retryable を宣言する例外。
  if (prop(error, "retryable") === true) return "server";

  const status = prop(error, "status") ?? prop(error, "statusCode");
  if (typeof status === "number" && Number.isFinite(status)) return fromStatus(status);

  // fetch は実際の原因を cause 側に入れるため、両方を見る。
  for (const candidate of [prop(error, "code"), prop(prop(error, "cause"), "code")]) {
    if (typeof candidate === "string" && NETWORK_CODES.has(candidate)) return "network";
  }

  const name = prop(error, "name");
  if (name === "AbortError" || name === "TimeoutError") return "network";

  return "unknown";
}

export type JobOutcome =
  | { action: "retry"; kind: ErrorKind; delayMs: number }
  | { action: "fail"; kind: ErrorKind };

/**
 * 失敗をretryにするか確定にするか決める。`attempt` は今回消費した後の値
 * （lease で +1 済み）。retryable でも上限（`MAX_ATTEMPTS`）に達したら確定させる。
 */
export function decideJobOutcome(
  error: unknown,
  attempt: number,
  rng: () => number = Math.random,
): JobOutcome {
  const kind = classifyJobError(error);
  if (!isRetryable(kind) || attempt >= MAX_ATTEMPTS) return { action: "fail", kind };
  return { action: "retry", kind, delayMs: backoffMs(attempt, rng) };
}

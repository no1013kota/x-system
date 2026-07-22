/**
 * Sentry `beforeSend` redaction (要件01 §8/§9). Removes secrets and pre-post
 * private content from events before they leave the process: Authorization /
 * Cookie headers, API keys, tokens, credentials, and prompt / base_md / 投稿前
 * 入力. Kept as a pure function (no Sentry runtime import) so it is unit-
 * testable and has no side effects.
 */

export const REDACTED = "[REDACTED]";

/** Object shape we touch on a Sentry event; broad on purpose. */
export interface RedactableEvent {
  request?: {
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A key whose VALUE must be masked wherever it appears. */
function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("authorization") ||
    k.includes("cookie") ||
    k.includes("token") ||
    k.includes("secret") ||
    k.includes("password") ||
    k.includes("credential") ||
    k.includes("api_key") ||
    k.includes("apikey") ||
    k === "api-key" ||
    k === "x-api-key" ||
    k === "client_id" ||
    k === "clientid" ||
    // pre-post private content / prompt material (要件01 §9)
    k === "prompt" ||
    k === "base_md" ||
    k === "instructions" ||
    k === "user_opinion" ||
    k === "content"
  );
}

const MAX_DEPTH = 8;

/** Recursively masks sensitive-keyed values in-place within plain objects/arrays. */
function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(val, depth + 1);
  }
  return out;
}

/**
 * Returns a redacted copy of the event. Header/cookie/secret/token/prompt
 * values are replaced with [REDACTED]. Returns the event (never null) so
 * capture still happens — just scrubbed.
 */
export function redactEvent<T extends RedactableEvent>(event: T): T {
  return redactValue(event, 0) as T;
}

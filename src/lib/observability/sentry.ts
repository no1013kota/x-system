import * as Sentry from "@sentry/nextjs";

import { redactEvent, type RedactableEvent } from "./redact";

/**
 * Sentry initialization (要件01 §2/§8). No-op when the DSN is unset or invalid
 * (e.g. dev, or a non-empty placeholder like "__TODO_sentry_dsn__") so the app
 * runs without Sentry instead of throwing/logging on every startup. `beforeSend`
 * scrubs secrets/prompt content via redactEvent. Server and client init are
 * separate so each uses its own DSN and runtime.
 */

const beforeSend = (event: Sentry.ErrorEvent): Sentry.ErrorEvent =>
  redactEvent(event as unknown as RedactableEvent) as unknown as Sentry.ErrorEvent;

const COMMON = {
  tracesSampleRate: 0,
  // errors + messages only for MVP; no PII, redaction below is the safety net
  sendDefaultPii: false,
  beforeSend,
} as const;

/**
 * True only for a syntactically valid http(s) DSN. Guards against unset values
 * and non-empty placeholders (e.g. "__TODO_sentry_dsn__" in local .env), which
 * would otherwise make Sentry.init log "Invalid Sentry Dsn" on every startup and
 * can disrupt client bootstrap.
 */
function isUsableDsn(dsn: string | undefined): dsn is string {
  if (!dsn) return false;
  try {
    const { protocol } = new URL(dsn);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Server/edge runtime init. Reads SENTRY_DSN; no-op when unset or invalid. */
export function initServerSentry(dsn = process.env.SENTRY_DSN): void {
  if (!isUsableDsn(dsn)) return;
  Sentry.init({ dsn, ...COMMON });
}

/** Browser init. Reads NEXT_PUBLIC_SENTRY_DSN; no-op when unset or invalid. */
export function initClientSentry(
  dsn = process.env.NEXT_PUBLIC_SENTRY_DSN,
): void {
  if (!isUsableDsn(dsn)) return;
  Sentry.init({ dsn, ...COMMON });
}

/**
 * Captures a server-side exception. Safe to call even when Sentry is not
 * initialized (Sentry no-ops). Never pass secrets in `context`.
 */
export function captureServerException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

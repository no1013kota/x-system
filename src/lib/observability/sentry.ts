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
  // eslint-disable-next-line no-restricted-syntax -- DSNがURLとして不正であること自体が判定結果。不正時の警告は呼び出し側で出す
  } catch {
    return false;
  }
}

/** Server/edge runtime init. Reads SENTRY_DSN; no-op when unset or invalid. */
export function initServerSentry(dsn = process.env.SENTRY_DSN): void {
  if (!isUsableDsn(dsn)) {
    // DSN未設定はローカル開発の正常系。しかし「設定したのに不正」を黙って無効化すると
    // 観測基盤そのものが沈黙し、記録されていないことに誰も気付けない。
    if (dsn) console.warn("[sentry] SENTRY_DSN が不正なため Sentry を無効化しました");
    return;
  }
  Sentry.init({ dsn, ...COMMON });
}

/** Browser init. Reads NEXT_PUBLIC_SENTRY_DSN; no-op when unset or invalid. */
export function initClientSentry(
  dsn = process.env.NEXT_PUBLIC_SENTRY_DSN,
): void {
  if (!isUsableDsn(dsn)) {
    if (dsn) console.warn("[sentry] NEXT_PUBLIC_SENTRY_DSN が不正なため Sentry を無効化しました");
    return;
  }
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

/**
 * 未知の例外が利用者向けの結果へ変換される境界で、原因を1度だけ記録する。
 *
 * Next.js の `onRequestError`（`src/instrumentation.ts`）は **throw された** 例外を Sentry へ送る。
 * しかし Server Action / API Route / job の共通出口は catch して値を返すため、その経路では発火せず、
 * 原因が画面にもログにもDBにも残らない（2026-07-26 のX連携不具合がこれで追跡不能になった）。
 * そこで「未知＝`internal_error` に丸められた」ときだけここで記録する。
 *
 * `AppError`（上限到達・キー未登録など仕様どおりの分岐）は記録しない。記録すると本物の異常が
 * ノイズに埋もれるため。呼び出し側は `toUserFacingError` の結果コードで判定して渡すこと。
 */
export function recordUnexpectedError(
  error: unknown,
  context: { at: string } & Record<string, unknown>,
): void {
  captureServerException(error, context);
  // Sentry未設定（DSNなし＝ローカル開発）でも原因が追えるように、標準エラー出力にも残す。
  console.error(`[unexpected] ${context.at}`, error);
}

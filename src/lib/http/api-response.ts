import { toUserFacingError, type ErrorCode } from "@/lib/observability/errors";
import { recordUnexpectedError } from "@/lib/observability/sentry";

/**
 * Shared JSON API response helpers for Route Handlers (要件05 §2.2). Centralizes
 * the ErrorCode→HTTP status table and the `no-store` JSON envelope that were
 * duplicated across the Stripe checkout/portal handlers.
 */
const HTTP_STATUS_FOR_ERROR: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  validation_error: 400,
  legal_consent_required: 403,
  automation_consent_required: 403,
  subscription_required: 402,
  usage_limit_exceeded: 403,
  x_account_required: 400,
  api_key_required: 400,
  persona_required: 400,
  feature_disabled: 403,
  provider_error: 502,
  post_state_unknown: 409,
  job_conflict: 409,
  not_found: 404,
  internal_error: 500,
};

/** JSON response with `cache-control: no-store`. */
export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** Maps any error to a safe `{ ok: false, error }` JSON response. */
export function apiError(error: unknown): Response {
  const safe = toUserFacingError(error);
  // Server Action と同様、throw せず Response で返すため `onRequestError` が発火しない。
  if (safe.code === "internal_error") {
    recordUnexpectedError(error, { at: "api-route" });
  }
  return apiJson({ ok: false, error: safe }, HTTP_STATUS_FOR_ERROR[safe.code]);
}

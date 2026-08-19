import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Passes the proxy-verified identity only to downstream server code in the same request.
 * Next.js upstream request headers are not exposed in the browser response.
 */
const AUTH_STATE_HEADER = "x-exos-verified-auth";
const AUTH_USER_ID_HEADER = "x-exos-verified-user-id";
const AUTH_USER_EMAIL_HEADER = "x-exos-verified-user-email";
const AUTH_SIGNATURE_HEADER = "x-exos-verified-auth-signature";

const AUTHENTICATED = "authenticated-v1";
const ANONYMOUS = "anonymous-v1";

export interface CurrentUser {
  email: string | null;
  id: string;
}

type ReadableHeaders = Pick<Headers, "get">;
type WritableHeaders = Pick<Headers, "delete" | "set">;

function signatureFor(
  secret: Buffer,
  state: string,
  id: string,
  encodedEmail: string,
): string {
  return createHmac("sha256", secret)
    .update(`${state}\0${id}\0${encodedEmail}`)
    .digest("base64url");
}

function signaturesMatch(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Removes untrusted incoming values before writing a signed proxy result. */
export function writeVerifiedUserHeaders(
  headers: WritableHeaders,
  user: CurrentUser | null,
  secret: Buffer,
): void {
  headers.delete(AUTH_STATE_HEADER);
  headers.delete(AUTH_USER_ID_HEADER);
  headers.delete(AUTH_USER_EMAIL_HEADER);
  headers.delete(AUTH_SIGNATURE_HEADER);

  if (!user) {
    headers.set(AUTH_STATE_HEADER, ANONYMOUS);
    headers.set(
      AUTH_SIGNATURE_HEADER,
      signatureFor(secret, ANONYMOUS, "", ""),
    );
    return;
  }

  const encodedEmail = user.email ? encodeURIComponent(user.email) : "";
  headers.set(AUTH_STATE_HEADER, AUTHENTICATED);
  headers.set(AUTH_USER_ID_HEADER, user.id);
  if (encodedEmail) {
    // Keep header values ASCII-only. A decode failure falls back to Supabase Auth.
    headers.set(AUTH_USER_EMAIL_HEADER, encodedEmail);
  }
  headers.set(
    AUTH_SIGNATURE_HEADER,
    signatureFor(secret, AUTHENTICATED, user.id, encodedEmail),
  );
}

/**
 * `undefined` means no valid proxy context and triggers an Auth fallback.
 * `null` is an explicitly verified anonymous request and needs no second Auth call.
 */
export function readVerifiedUserHeaders(
  headers: ReadableHeaders,
  secret: Buffer,
): CurrentUser | null | undefined {
  const state = headers.get(AUTH_STATE_HEADER);
  if (state !== ANONYMOUS && state !== AUTHENTICATED) return undefined;

  const id = headers.get(AUTH_USER_ID_HEADER) ?? "";
  const encodedEmail = headers.get(AUTH_USER_EMAIL_HEADER) ?? "";
  const signature = headers.get(AUTH_SIGNATURE_HEADER);
  if (
    !signature ||
    !signaturesMatch(signature, signatureFor(secret, state, id, encodedEmail))
  ) {
    return undefined;
  }
  if (state === ANONYMOUS) return null;
  if (!id) return undefined;

  if (!encodedEmail) return { email: null, id };
  try {
    return { email: decodeURIComponent(encodedEmail), id };
  // eslint-disable-next-line no-restricted-syntax -- malformed input is validation failure; fall back to Auth without logging
  } catch {
    return undefined;
  }
}

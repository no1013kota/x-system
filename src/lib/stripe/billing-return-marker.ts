import { decryptWithKey, encryptWithKey } from "@/lib/crypto/envelope";

export const BILLING_RETURN_COOKIE = "billing_return_tx";
export const BILLING_RETURN_MAX_AGE_SEC = 30 * 60;

export type BillingReturnSource = "checkout" | "portal";

export interface BillingReturnMarker {
  issuedAt: number;
  source: BillingReturnSource;
  userId: string;
}

export function sealBillingReturnMarker(
  marker: BillingReturnMarker,
  key: Buffer,
): string {
  return encryptWithKey(JSON.stringify(marker), key);
}

export function openBillingReturnMarker(
  sealed: string,
  key: Buffer,
  now: number,
): BillingReturnMarker {
  const marker = JSON.parse(decryptWithKey(sealed, key)) as BillingReturnMarker;
  if (
    !marker.userId ||
    (marker.source !== "checkout" && marker.source !== "portal") ||
    !Number.isInteger(marker.issuedAt) ||
    marker.issuedAt > now ||
    now - marker.issuedAt > BILLING_RETURN_MAX_AGE_SEC
  ) {
    throw new Error("Billing return marker is invalid or expired.");
  }
  return marker;
}

export function billingReturnCookieHeader(
  value: string,
  secure: boolean,
  maxAge = BILLING_RETURN_MAX_AGE_SEC,
): string {
  return [
    `${BILLING_RETURN_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearBillingReturnCookieHeader(secure: boolean): string {
  return billingReturnCookieHeader("", secure, 0);
}

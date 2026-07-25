import "server-only";

import { getAppEncryptionKey } from "@/lib/crypto";
import { env } from "@/lib/env";

import {
  billingReturnCookieHeader,
  openBillingReturnMarker,
  sealBillingReturnMarker,
  type BillingReturnMarker,
  type BillingReturnSource,
} from "./billing-return-marker";

function key(): Buffer {
  return getAppEncryptionKey();
}

export function issueBillingReturnCookie(
  userId: string,
  source: BillingReturnSource,
  now = Math.floor(Date.now() / 1000),
): string {
  return billingReturnCookieHeader(
    sealBillingReturnMarker({ issuedAt: now, source, userId }, key()),
    env.APP_ENV === "production",
  );
}

export function readBillingReturnMarker(
  rawCookieValue: string,
  now = Math.floor(Date.now() / 1000),
): BillingReturnMarker {
  return openBillingReturnMarker(
    decodeURIComponent(rawCookieValue),
    key(),
    now,
  );
}

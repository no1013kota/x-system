import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Bearer auth for the internal job dispatch endpoint and cron routes
 * (要件01 §3.1, 要件05 §3/§11). Uses CRON_SECRET with a constant-time compare.
 * No fallback: a missing CRON_SECRET always denies (要件01 §3.1).
 */
export function isValidCronAuth(authHeader: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (!authHeader) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

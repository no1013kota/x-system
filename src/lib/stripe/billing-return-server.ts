import "server-only";

import { getCurrentUser } from "@/lib/auth/session";
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

/**
 * checkout/portal route 共通: `getCurrentUser` をラップして解決した userId を捕捉する。
 * ハンドラは認証時に getCurrentUser を呼ぶので、応答成功後に `capturedUserId()` で userId を得て
 * billing-return cookie を発行できる（各 route が同じ捕捉ロジックを手書きする重複を解消）。
 */
export function captureBillingUser() {
  let userId: string | undefined;
  return {
    async getCurrentUser() {
      const user = await getCurrentUser();
      userId = user?.id;
      return user;
    },
    capturedUserId(): string | undefined {
      return userId;
    },
  };
}

/**
 * 応答が ok かつ userId が取れているときだけ billing-return cookie を付与して返す
 * （checkout/portal 共通の後処理）。それ以外は応答をそのまま返す。
 */
export function appendBillingReturnCookie(
  response: Response,
  userId: string | undefined,
  source: BillingReturnSource,
): Response {
  if (response.ok && userId) {
    response.headers.append("set-cookie", issueBillingReturnCookie(userId, source));
  }
  return response;
}

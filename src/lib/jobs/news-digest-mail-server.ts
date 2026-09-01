import "server-only";

import { sendMailViaSmtp } from "@/lib/email/smtp-mail-server";
import { env } from "@/lib/env";
import { recordUnexpectedError } from "@/lib/observability/sentry";

import type { NewsDigestEmailTarget } from "./news-digest";
import { sendNewsDigestMailsWith, type NewsDigestMailResult } from "./news-digest-mail";

/**
 * ニュースダイジェストメールの server-only 配線（T-M8-407）。
 * SMTP（環境ガード込み）・`APP_BASE_URL`・Sentry を束ねて純粋層へ渡す。
 * 失敗は利用者ごとに Sentry へ記録し、件数は cron の結果（news_fetch の応答）に載る。
 */
export function sendNewsDigestMails(
  targets: readonly NewsDigestEmailTarget[],
): Promise<NewsDigestMailResult> {
  return sendNewsDigestMailsWith(targets, {
    baseUrl: env.APP_BASE_URL as string,
    send: sendMailViaSmtp,
    onError: (target, error) =>
      recordUnexpectedError(error, {
        at: "news-digest-mail",
        notificationId: target.notificationId,
        userId: target.userId,
      }),
  });
}

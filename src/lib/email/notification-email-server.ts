import "server-only";

import { after } from "next/server";

import { pooledQueryable } from "../db/pool";
import { env } from "../env";
import {
  sendQueuedNotificationEmail,
  type EmailTransport,
  type NotificationEmailResult,
} from "./notification-email";
import { classifySmtpError } from "./smtp-error";

/**
 * 通知メール送信の server-only 配線（要件04 §14, 要件01 §3.6/§8, T-M4-16）。SMTP（Gmail・587 STARTTLS）
 * トランスポートを env から遅延構築し、純粋層（`notification-email.ts`）へ注入する。SMTP未設定なら送信を
 * skip する（ローカル・未発行環境で安全）。実Gmail送信の確認は App Password 発行後（open_questions）。
 */

const pooledDb = pooledQueryable();

let transportPromise: Promise<EmailTransport | null> | null = null;

function fromDomain(fromAddress: string): string {
  const at = fromAddress.lastIndexOf("@");
  const domain = at >= 0 ? fromAddress.slice(at + 1).replace(/>.*$/, "").trim() : "";
  return domain || "localhost";
}

async function buildTransport(): Promise<EmailTransport | null> {
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_APP_PASSWORD || !env.EMAIL_FROM) {
    return null;
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465, // 465=implicit TLS、587=STARTTLS
    requireTLS: env.SMTP_PORT === 587,
    auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
  });
  return {
    async sendMail(msg) {
      try {
        const info = await transporter.sendMail({
          from: msg.from,
          to: msg.to,
          replyTo: msg.replyTo,
          subject: msg.subject,
          text: msg.text,
          messageId: msg.messageId,
        });
        return { providerId: info.messageId ?? null };
      } catch (error) {
        throw classifySmtpError(error);
      }
    },
  };
}

function getTransport(): Promise<EmailTransport | null> {
  if (!transportPromise) transportPromise = buildTransport();
  return transportPromise;
}

/** 通知メール1件を送る（SMTP未設定なら skip）。tick回収・after()送信の共通入口。 */
export async function sendNotificationEmailForId(
  notificationId: string,
): Promise<NotificationEmailResult> {
  const transport = await getTransport();
  if (!transport || !env.EMAIL_FROM) return { outcome: "skipped" };
  return sendQueuedNotificationEmail(
    {
      db: pooledDb,
      transport,
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
      appBaseUrl: env.APP_BASE_URL,
      domain: fromDomain(env.EMAIL_FROM),
    },
    notificationId,
  );
}

/**
 * 通知row commit 後の best-effort 即時送信（要件04 §14）。`after()` で応答後に送信し、失敗は握り潰す
 * （queued のまま残り scheduler_tick が回収する）。request/handler スコープから呼ぶ。
 */
export function dispatchNotificationEmail(notificationId: string): void {
  after(() => sendNotificationEmailForId(notificationId).catch(() => {}));
}

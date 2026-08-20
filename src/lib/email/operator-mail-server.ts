import "server-only";

import { canSendViaSmtp } from "./notification-email";
import { env } from "@/lib/env";

/**
 * 運営者への状態メールを送る（T-M8-164）。
 *
 * 通知メール（`notification-email-server.ts`）とは**別の入口**にする。あちらは
 * `notifications` の行を前提に配信状態（`email_status`）を更新する仕組みで、
 * 運営者向けの状態メールは通知テーブルに載らない（利用者の通知一覧へ出すものではない）。
 *
 * 送信条件は通知メールと同じガードを共有する（`canSendViaSmtp`）——
 * **非productionから外部SMTPへ送らない**。ローカルで確認したいときは
 * `SMTP_HOST` を Mailpit 等のループバックへ向ける（local-development.md §5）。
 */
export async function sendOperatorMail(msg: {
  subject: string;
  text: string;
  to: string;
}): Promise<void> {
  if (!env.SMTP_HOST || !env.EMAIL_FROM) {
    console.warn("[operator-mail] SMTPまたは差出人が未設定のため送信をskipしました");
    return;
  }
  if (!canSendViaSmtp({ appEnv: env.APP_ENV, host: env.SMTP_HOST })) {
    console.warn(
      `[operator-mail] APP_ENV=${env.APP_ENV} のため外部SMTP(${env.SMTP_HOST})への送信をskipしました`,
    );
    return;
  }
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT === 587,
    auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
  });
  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
}

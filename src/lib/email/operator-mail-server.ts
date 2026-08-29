import "server-only";

import { canSendViaSmtp } from "./smtp-guard";
import { env } from "@/lib/env";
import { EXPECTED_SENDER_EMAIL, EXPECTED_SENDER_NAME } from "@/lib/ops/auth-url-status";

/**
 * 運営者への状態メールを送る（T-M8-164）。
 *
 * 利用者向け通知メールはT-M8-222で廃止した。メール送信はこの運営者向け状態メールと
 * 認証メール（Supabase Auth）だけが残る。送信条件は `canSendViaSmtp` ——
 * **非productionから外部SMTPへ送らない**。ローカルで確認したいときは
 * `SMTP_HOST` を Mailpit 等のループバックへ向ける（local-development.md §5）。
 */
export async function sendOperatorMail(msg: {
  subject: string;
  text: string;
  to: string;
}): Promise<void> {
  if (!env.SMTP_HOST) {
    console.warn("[operator-mail] SMTPが未設定のため送信をskipしました");
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
    /*
      **Exos AIから出るメールはすべて同じ差出人**（T-M8-339・運営者の指示 2026-08-27）。
      envを入れ忘れた環境で運営者個人のアドレスから出るのを防ぐため、既定をコード側に持つ
      （原則3）。envは緊急の差し替え用に残す。
    */
    from: env.EMAIL_FROM ?? `${EXPECTED_SENDER_NAME} <${EXPECTED_SENDER_EMAIL}>`,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
}

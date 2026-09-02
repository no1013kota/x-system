import "server-only";

import { canSendViaSmtp } from "./smtp-guard";
import { env } from "@/lib/env";
import { EXPECTED_SENDER_EMAIL, EXPECTED_SENDER_NAME } from "@/lib/ops/auth-url-status";

/**
 * SMTP送信の**唯一の出口**（T-M8-164→T-M8-407で共通化）。
 *
 * 運営者向け状態メール（`operator-mail-server.ts`）と、利用者向けのニュースダイジェスト
 * メール（`jobs/news-digest-mail-server.ts`・T-M8-407）がここを通る。送信条件は
 * `canSendViaSmtp`——**非productionから外部SMTPへ送らない**（2026-07-27の98通誤送信の再発防止）。
 * ローカルで確認したいときは `SMTP_HOST` を Mailpit 等のループバックへ向ける
 * （local-development.md §5）。
 *
 * 戻り値で「送った」「設定/環境の都合で送らなかった」を区別する（黙ってskipしない・原則1）。
 */
export type SmtpSendOutcome = "sent" | "skipped_no_smtp" | "skipped_env_guard";

export async function sendMailViaSmtp(msg: {
  subject: string;
  text: string;
  to: string;
}): Promise<SmtpSendOutcome> {
  if (!env.SMTP_HOST) return "skipped_no_smtp";
  if (!canSendViaSmtp({ appEnv: env.APP_ENV, host: env.SMTP_HOST })) return "skipped_env_guard";
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
  return "sent";
}

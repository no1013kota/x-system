import "server-only";

import { sendMailViaSmtp } from "./smtp-mail-server";

/**
 * 運営者への状態メールを送る（T-M8-164）。
 *
 * 送信の実体は `smtp-mail-server.ts`（T-M8-407で利用者向けニュースメールと共通化）。
 * 送信条件は `canSendViaSmtp`——**非productionから外部SMTPへ送らない**。
 * skipは理由つきでログへ出す（運営者向けの一方通行の通知なので、ここではそれで足りる）。
 */
export async function sendOperatorMail(msg: {
  subject: string;
  text: string;
  to: string;
}): Promise<void> {
  const outcome = await sendMailViaSmtp(msg);
  if (outcome === "skipped_no_smtp") {
    console.warn("[operator-mail] SMTPが未設定のため送信をskipしました");
  } else if (outcome === "skipped_env_guard") {
    console.warn("[operator-mail] 非productionのため外部SMTPへの送信をskipしました");
  }
}

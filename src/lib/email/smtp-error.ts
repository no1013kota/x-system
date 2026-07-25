import type { ErrorKind } from "../jobs/retry";
import { EmailSendError } from "./notification-email";

/**
 * SMTP/nodemailer エラーを retry 分類（要件04 §14: 429/5xx/network は再送、認証系は終端）へ写像する
 * 純粋モジュール。server-only 配線（notification-email-server.ts）から切り出し、env/SMTP に依存せず
 * 単体テスト可能にした。秘密値・宛先は summary に含めない。
 */

interface SmtpError {
  code?: string;
  responseCode?: number;
}

const AUTH_RESPONSE_CODES = new Set([530, 534, 535]);
const NETWORK_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ECONNRESET",
  "EENVELOPE",
]);

/** SMTP/nodemailer エラーを retry 分類へ写像する（要件04 §14: 429/5xx/network再送、401/403終端）。 */
export function classifySmtpError(error: unknown): EmailSendError {
  const e = (error ?? {}) as SmtpError;
  const code = typeof e.code === "string" ? e.code : undefined;
  const responseCode = typeof e.responseCode === "number" ? e.responseCode : undefined;
  let kind: ErrorKind = "unknown";
  if (code === "EAUTH" || (responseCode != null && AUTH_RESPONSE_CODES.has(responseCode))) {
    kind = "auth";
  } else if (code && NETWORK_CODES.has(code)) {
    kind = "network";
  } else if (responseCode != null && responseCode >= 400 && responseCode < 600) {
    kind = "server";
  }
  // 秘密値・宛先を含めない要約のみ保存する。
  const summary = `smtp:${code ?? "err"}${responseCode != null ? `:${responseCode}` : ""}`;
  return new EmailSendError(kind, summary);
}

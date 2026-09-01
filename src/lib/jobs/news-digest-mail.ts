import type { NewsDigestEmailTarget } from "./news-digest";

/**
 * ニュースダイジェストのメール（T-M8-407・運営者の指示 2026-09-01）。純粋層。
 *
 * アプリ内通知と同じ内容（件数・上位5件・一覧リンク）を、メール通知ONの利用者へ送る。
 * 送信は注入（`send`）——SMTPと環境ガードは `email/smtp-mail-server.ts` が持つ。
 * **1人の失敗で他の人へ送るのをやめない**（失敗は数えて記録し、続ける・原則1）。
 */

export interface NewsDigestMailMessage {
  to: string;
  subject: string;
  text: string;
}

/** メールの件名・本文を組む。リンクは絶対URLにする（メールでは相対リンクが辿れない）。 */
export function buildNewsDigestMail(
  target: NewsDigestEmailTarget,
  baseUrl: string,
): NewsDigestMailMessage {
  const url = `${baseUrl.replace(/\/$/, "")}${target.link}`;
  const text = [
    `設定したテーマ・インパクトに該当する新着ニュースが${target.totalCount}件ありました。`,
    "",
    target.body,
    "",
    `一覧を見る: ${url}`,
    "",
    "このメールは、Exos AI の設定＞通知で「ニュース通知をメールでも受け取る」をONにしている方へ送っています。",
    "止めるには同じ画面でOFFにしてください。",
  ].join("\n");
  return { to: target.to, subject: `【Exos AI】${target.title}`, text };
}

export type MailSendOutcome = "sent" | "skipped_no_smtp" | "skipped_env_guard";

export interface NewsDigestMailResult {
  targets: number;
  sent: number;
  /** SMTP未設定・非production ガードで送らなかった件数（失敗ではない）。 */
  skipped: number;
  failed: number;
}

export async function sendNewsDigestMailsWith(
  targets: readonly NewsDigestEmailTarget[],
  deps: {
    baseUrl: string;
    send: (message: NewsDigestMailMessage) => Promise<MailSendOutcome>;
    onError: (target: NewsDigestEmailTarget, error: unknown) => void;
  },
): Promise<NewsDigestMailResult> {
  const result: NewsDigestMailResult = { targets: targets.length, sent: 0, skipped: 0, failed: 0 };
  for (const target of targets) {
    try {
      const outcome = await deps.send(buildNewsDigestMail(target, deps.baseUrl));
      if (outcome === "sent") result.sent += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      deps.onError(target, error);
    }
  }
  return result;
}

import { MAX_ATTEMPTS, backoffMs, isRetryable, type ErrorKind } from "../jobs/retry";
import type { Queryable } from "../x/token-refresh";

/**
 * 通知メール送信の中核（要件04 §14, 要件01 §3.6/§8, 要件02 §3.15, T-M4-16）。DBとSMTPトランスポートを
 * 注入し純粋に保つ。`email_status='queued'` かつ送信可能時刻に達した通知1件を送る:
 * - 成功: `email_status='sent'`・`email_provider_id`・`email_sent_at` を保存（`id AND email_status='queued'`
 *   guard で二重送信を防止。provider冪等keyは `notification:{id}` の Message-ID）。
 * - 429/5xx/network かつ attempt<3: `email_attempts` 加算＋指数backoffで `email_available_at` を更新し queued 継続。
 * - 401/403 または 3 attempt 失敗: `email_status='failed'`。`email_error` には秘密値を含まない要約のみ。
 * 実SMTP接続・エラー分類は server 配線（`notification-email-server.ts`）が担う。
 */

export interface EmailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  /** provider冪等用の Message-ID（`<notification:{id}@domain>`）。 */
  messageId: string;
}

export interface EmailSendResult {
  providerId: string | null;
}

export interface EmailTransport {
  sendMail(msg: EmailMessage): Promise<EmailSendResult>;
}

/** 送信失敗を分類済みで表す（server がSMTPエラーから構築）。summary は秘密値を含まない要約のみ。 */
export class EmailSendError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly summary: string,
  ) {
    super(summary);
    this.name = "EmailSendError";
  }
}

export interface NotificationEmailDeps {
  db: Queryable;
  transport: EmailTransport;
  from: string;
  replyTo?: string;
  /** 相対linkを絶対URL化する基点（例 https://app.example）。 */
  appBaseUrl?: string;
  /** Message-ID のドメイン部。 */
  domain: string;
  /** backoff jitter の乱数（テスト決定化用）。 */
  rng?: () => number;
}

export type NotificationEmailOutcome = "sent" | "requeued" | "failed" | "skipped";

export interface NotificationEmailResult {
  outcome: NotificationEmailOutcome;
  attempts?: number;
}

interface QueuedRow {
  id: string;
  title: string;
  body: string;
  link: string | null;
  email_attempts: number;
  recipient: string;
}

function buildText(body: string, link: string | null, appBaseUrl?: string): string {
  if (!link) return body;
  const url = appBaseUrl && link.startsWith("/") ? `${appBaseUrl.replace(/\/$/, "")}${link}` : link;
  return `${body}\n\n詳細: ${url}`;
}

/**
 * queued な通知メールを1件送る。送信可能時刻に達した queued 行のみが対象で、対象外・既送信・不在は skip。
 */
export async function sendQueuedNotificationEmail(
  deps: NotificationEmailDeps,
  notificationId: string,
): Promise<NotificationEmailResult> {
  const { db } = deps;
  const { rows } = await db.query<QueuedRow>(
    `select n.id, n.title, n.body, n.link, n.email_attempts, p.email as recipient
       from notifications n
       join profiles p on p.id = n.user_id
      where n.id = $1
        and n.email_status = 'queued'
        and (n.email_available_at is null or n.email_available_at <= now())`,
    [notificationId],
  );
  const row = rows[0];
  if (!row) return { outcome: "skipped" };

  const message: EmailMessage = {
    to: row.recipient,
    from: deps.from,
    replyTo: deps.replyTo,
    subject: row.title,
    text: buildText(row.body, row.link, deps.appBaseUrl),
    messageId: `<notification:${row.id}@${deps.domain}>`,
  };

  try {
    const result = await deps.transport.sendMail(message);
    const sent = await db.query(
      `update notifications
          set email_status = 'sent', email_provider_id = $2,
              email_sent_at = now(), email_last_attempt_at = now()
        where id = $1 and email_status = 'queued'`,
      [row.id, result.providerId],
    );
    // guard で0件なら別経路が確定済み。二重送信は Message-ID とこの guard で防ぐ。
    return { outcome: (sent.rowCount ?? 0) > 0 ? "sent" : "skipped" };
  } catch (error) {
    const kind: ErrorKind = error instanceof EmailSendError ? error.kind : "unknown";
    const summary = error instanceof EmailSendError ? error.summary : "send_failed";
    const attempts = row.email_attempts + 1;

    if (isRetryable(kind) && attempts < MAX_ATTEMPTS) {
      await db.query(
        `update notifications
            set email_attempts = $2, email_error = $3,
                email_last_attempt_at = now(),
                email_available_at = now() + ($4 || ' milliseconds')::interval
          where id = $1 and email_status = 'queued'`,
        [row.id, attempts, summary, backoffMs(attempts, deps.rng)],
      );
      return { outcome: "requeued", attempts };
    }

    await db.query(
      `update notifications
          set email_status = 'failed', email_attempts = $2, email_error = $3,
              email_last_attempt_at = now()
        where id = $1 and email_status = 'queued'`,
      [row.id, attempts, summary],
    );
    return { outcome: "failed", attempts };
  }
}

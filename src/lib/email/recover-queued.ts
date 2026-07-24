import type { NotificationEmailResult } from "./notification-email";
import type { Queryable } from "../x/token-refresh";

/**
 * queued メールの回収（scheduler_tick 第4段, 要件04 §6/§14, T-M4-17）。送信可能時刻に達した queued
 * 通知メールを1起動あたり最大 EMAIL_BATCH 件・最大 EMAIL_CONCURRENCY 並列で送信処理する。個々の送信・
 * 冪等・retry/backoff/failed 確定は `sendQueuedNotificationEmail`（注入 `send`）が担う。最古の実行可能
 * queued メールが staleMinutes を超えていれば onStaleWarning（Sentry想定）へ警告する。
 */

const EMAIL_BATCH = 100;
const EMAIL_CONCURRENCY = 10;
const STALE_MINUTES = 10;

export interface RecoverQueuedEmailsDeps {
  db: Queryable;
  /** 通知メール1件の送信（server配線は sendNotificationEmailForId）。 */
  send: (notificationId: string) => Promise<NotificationEmailResult>;
  limit?: number;
  concurrency?: number;
  staleMinutes?: number;
  /** 最古の実行可能 queued メールが閾値超のとき通知する（Sentry想定）。 */
  onStaleWarning?: (oldestAgeMs: number) => void;
}

export interface RecoverQueuedEmailsResult {
  processed: number;
  sent: number;
  requeued: number;
  failed: number;
}

/** items を最大 limit 並列で worker に流す固定サイズプール。 */
async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function recoverQueuedEmails(
  deps: RecoverQueuedEmailsDeps,
): Promise<RecoverQueuedEmailsResult> {
  const limit = deps.limit ?? EMAIL_BATCH;
  const concurrency = deps.concurrency ?? EMAIL_CONCURRENCY;
  const staleMinutes = deps.staleMinutes ?? STALE_MINUTES;

  // 最古の実行可能 queued メールの滞留時間を確認（バックログ検知・要件04 §14）。
  const { rows: ageRows } = await deps.db.query<{ age_ms: number | null }>(
    `select extract(epoch from (now() - min(created_at))) * 1000 as age_ms
       from notifications
      where email_status = 'queued' and (email_available_at is null or email_available_at <= now())`,
  );
  const oldestAgeMs = ageRows[0]?.age_ms ?? null;
  if (deps.onStaleWarning && oldestAgeMs != null && oldestAgeMs > staleMinutes * 60_000) {
    deps.onStaleWarning(oldestAgeMs);
  }

  const { rows } = await deps.db.query<{ id: string }>(
    `select id from notifications
      where email_status = 'queued' and (email_available_at is null or email_available_at <= now())
      order by email_available_at asc nulls first, created_at asc
      limit $1`,
    [limit],
  );
  const ids = rows.map((r) => r.id);

  const result: RecoverQueuedEmailsResult = { processed: ids.length, sent: 0, requeued: 0, failed: 0 };
  const outcomes = await runPool(ids, concurrency, (id) => deps.send(id));
  for (const o of outcomes) {
    if (o?.outcome === "sent") result.sent += 1;
    else if (o?.outcome === "requeued") result.requeued += 1;
    else if (o?.outcome === "failed") result.failed += 1;
  }
  return result;
}

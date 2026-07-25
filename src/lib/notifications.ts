import { AppError } from "@/lib/observability/errors";

import { toIso } from "./format";
import type { Queryable } from "./x/token-refresh";

/**
 * アプリ内通知の閲覧・既読化の中核（要件05 §10・要件02 §3.15, O-2）。DBは注入し純粋に保つ。
 * 一覧は in_app_enabled=true のみ、本人スコープ、created_at desc の keyset cursor ページング。
 * 通知rowの作成・メール送信はジョブ系マイルストーンが担う（ここは閲覧・既読化のみ）。
 */

export const NOTIFICATIONS_PAGE_SIZE = 20;

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationCursor {
  createdAt: string;
  id: string;
}

export interface NotificationPage {
  items: NotificationView[];
  nextCursor: string | null;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeNotificationCursor(
  raw: string | null | undefined,
): NotificationCursor | null {
  if (!raw) return null;
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const sep = decoded.lastIndexOf("|");
  if (sep <= 0) return null;
  const createdAt = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!createdAt || !id) return null;
  return { createdAt, id };
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: Date | string | null;
  created_at: Date | string;
}

/**
 * 本人のアプリ内通知を新しい順に返す（keyset cursor）。unreadOnly で未読のみに絞れる。
 * limit+1 件取得し、超過分があれば nextCursor を返す。
 */
export async function listNotifications(
  db: Queryable,
  userId: string,
  options: { cursor?: string | null; unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationPage> {
  const limit = Math.min(Math.max(options.limit ?? NOTIFICATIONS_PAGE_SIZE, 1), 50);
  const cursor = decodeNotificationCursor(options.cursor);

  const params: unknown[] = [userId];
  let where = "user_id = $1 and in_app_enabled = true";
  if (options.unreadOnly) where += " and read_at is null";
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    where += ` and (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);

  const { rows } = await db.query<NotificationRow>(
    `select id, type, title, body, link, read_at, created_at
       from notifications
      where ${where}
      order by created_at desc, id desc
      limit $${params.length}`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items: NotificationView[] = page.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    createdAt: toIso(r.created_at),
    readAt: r.read_at ? toIso(r.read_at) : null,
  }));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeNotificationCursor({ createdAt: toIso(last.created_at), id: last.id })
      : null;
  return { items, nextCursor };
}

/** 本人のアプリ内未読件数。ベルのバッジ用。 */
export async function countUnreadNotifications(
  db: Queryable,
  userId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from notifications
      where user_id = $1 and in_app_enabled = true and read_at is null`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

/** 通知を既読化する（本人のみ・冪等）。他人所有・不在は not_found。 */
export async function markNotificationRead(
  db: Queryable,
  userId: string,
  notificationId: string,
): Promise<{ id: string; readAt: string }> {
  const { rows } = await db.query<{ id: string; read_at: Date | string }>(
    `update notifications set read_at = coalesce(read_at, now())
      where id = $1 and user_id = $2
      returning id, read_at`,
    [notificationId, userId],
  );
  if (!rows[0]) throw new AppError("not_found");
  return { id: rows[0].id, readAt: toIso(rows[0].read_at) };
}

/** 本人の未読アプリ内通知をすべて既読化し、更新件数を返す。 */
export async function markAllNotificationsRead(
  db: Queryable,
  userId: string,
): Promise<number> {
  const { rowCount } = await db.query(
    `update notifications set read_at = now()
      where user_id = $1 and in_app_enabled = true and read_at is null`,
    [userId],
  );
  return rowCount ?? 0;
}

/**
 * 失敗した通知メールの再送要求（要件04 §14・要件05 §10, T-M4-17）。本人・`email_status='failed'` のみ受理し、
 * `attempts` を0へ戻して queued 化する（scheduler_tick が回収して送る）。同一通知の1分以内の連続実行は
 * `email_last_attempt_at` guard で拒否する（job_conflict）。不在・他人・非failedも job_conflict/not_found。
 */
export async function retryNotificationEmail(
  db: Queryable,
  userId: string,
  notificationId: string,
): Promise<void> {
  const { rows } = await db.query<{ email_status: string }>(
    `select email_status from notifications where id = $1 and user_id = $2`,
    [notificationId, userId],
  );
  const row = rows[0];
  if (!row) throw new AppError("not_found");
  if (row.email_status !== "failed") {
    throw new AppError("job_conflict", { details: { reason: "not_failed" } });
  }
  const { rowCount } = await db.query(
    `update notifications
        set email_status = 'queued', email_attempts = 0, email_error = null,
            email_available_at = now()
      where id = $1 and user_id = $2 and email_status = 'failed'
        and (email_last_attempt_at is null or email_last_attempt_at < now() - interval '1 minute')`,
    [notificationId, userId],
  );
  // status は failed 確認済み。0件は時刻guard不成立＝1分以内の連続実行。
  if ((rowCount ?? 0) === 0) {
    throw new AppError("job_conflict", { details: { reason: "retry_too_soon" } });
  }
}

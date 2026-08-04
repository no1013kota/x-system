import { z } from "zod";

import { DB_ENUMS } from "@/lib/db/enums";

import {
  DEFAULT_NEWS_CONFIG,
  DEFAULT_NOTIFICATION_CONFIG,
  NEWS_MAX_ITEMS_MAX,
  NEWS_MAX_ITEMS_MIN,
} from "./config-defaults";
import type { Queryable } from "./x/token-refresh";

/**
 * プロフィール・通知・ニュース設定の中核（要件05 §4.1・要件02 §4.2/§4.3・要件06 §3.4, O-2/O-3）。
 * zodで検証し、未設定/不正なjsonbは §3.4 の既定値へフォールバックして読み出す。DBは注入し純粋に保つ。
 */

export const NOTIFICATION_TYPES = [
  "news",
  "draft_created",
  "posted",
  "error",
  "billing",
  "usage",
  "summary",
] as const;

const channelSchema = z
  .object({ in_app: z.boolean(), email: z.boolean() })
  .strict();

export const notificationConfigSchema = z
  .object({
    news: channelSchema,
    draft_created: channelSchema,
    posted: channelSchema,
    error: channelSchema,
    billing: channelSchema,
    usage: channelSchema,
    summary: channelSchema,
  })
  .strict();

const newsCategorySchema = z.enum(
  DB_ENUMS.news_category as unknown as [string, ...string[]],
);
const impactLevelSchema = z.enum(
  DB_ENUMS.impact_level as unknown as [string, ...string[]],
);
const unique = (arr: string[]) => new Set(arr).size === arr.length;

export const newsConfigSchema = z
  .object({
    categories: z
      .array(newsCategorySchema)
      .min(1, "テーマを1件以上選択してください")
      .refine(unique, "テーマが重複しています"),
    impact_filter: z
      .array(impactLevelSchema)
      .min(1, "インパクトを1件以上選択してください")
      .refine(unique, "インパクトが重複しています"),
    max_items: z.number().int().min(NEWS_MAX_ITEMS_MIN).max(NEWS_MAX_ITEMS_MAX),
  })
  .strict();


export type NotificationConfig = z.infer<typeof notificationConfigSchema>;
export type NewsConfig = z.infer<typeof newsConfigSchema>;

/** 通知設定を読み出す。未設定/不正は種別ごとに §3.4 既定値へフォールバックする。 */
export function resolveNotificationConfig(raw: unknown): NotificationConfig {
  const parsed = notificationConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = {} as NotificationConfig;
  for (const type of NOTIFICATION_TYPES) {
    const value = source[type];
    const channel = channelSchema.safeParse(value);
    out[type] = channel.success ? channel.data : { ...DEFAULT_NOTIFICATION_CONFIG[type] };
  }
  return out;
}

/** ニュース設定を読み出す。未設定/不正は §3.4 既定値へフォールバックする。 */
export function resolveNewsConfig(raw: unknown): NewsConfig {
  const parsed = newsConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return {
    categories: [...DEFAULT_NEWS_CONFIG.categories],
    impact_filter: [...DEFAULT_NEWS_CONFIG.impact_filter],
    max_items: DEFAULT_NEWS_CONFIG.max_items,
  };
}

export interface UserSettings {
  displayName: string | null;
  notificationConfig: NotificationConfig;
  newsConfig: NewsConfig;
}

export async function readSettings(
  db: Queryable,
  userId: string,
): Promise<UserSettings | null> {
  const { rows } = await db.query<{
    display_name: string | null;
    notification_config: unknown;
    news_config: unknown;
  }>(
    `select display_name, notification_config, news_config from profiles where id = $1`,
    [userId],
  );
  if (!rows[0]) return null;
  return {
    displayName: rows[0].display_name,
    notificationConfig: resolveNotificationConfig(rows[0].notification_config),
    newsConfig: resolveNewsConfig(rows[0].news_config),
  };
}


export async function saveNotificationConfig(
  db: Queryable,
  userId: string,
  config: NotificationConfig,
): Promise<void> {
  await db.query(
    `update profiles set notification_config = $2::jsonb, updated_at = now() where id = $1`,
    [userId, JSON.stringify(config)],
  );
}

export async function saveNewsConfig(
  db: Queryable,
  userId: string,
  config: NewsConfig,
): Promise<void> {
  await db.query(
    `update profiles set news_config = $2::jsonb, updated_at = now() where id = $1`,
    [userId, JSON.stringify(config)],
  );
}

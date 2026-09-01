import { z } from "zod";

import { DB_ENUMS } from "@/lib/db/enums";

import { DEFAULT_NEWS_CONFIG, DEFAULT_NOTIFICATION_CONFIG } from "./config-defaults";
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

/**
 * メール通知はT-M8-222で廃止（運営者の指示 2026-08-22）。チャネルはアプリ内のみ。
 * 過去に保存された `email` キーは黙って落とす（strictにすると全既存レコードのparseが
 * 失敗し、in_app の保存値まで既定へ戻ってしまう。DB側もmigrationで剥がす）。
 */
const channelSchema = z
  .object({ in_app: z.boolean() })
  .strip();

/**
 * **ニュースだけメールも選べる**（T-M8-407・運営者の指示 2026-09-01）。
 * 入力では `email` を省略できる——省略は「保存済みの値を保つ」（アプリ内通知の画面は
 * in_app だけを送るので、ニュース設定の画面で付けたメールONを黙って外さない）。
 */
const newsChannelInputSchema = z
  .object({ in_app: z.boolean(), email: z.boolean().optional() })
  .strip();

export const notificationConfigSchema = z
  .object({
    news: newsChannelInputSchema,
    draft_created: channelSchema,
    posted: channelSchema,
    error: channelSchema,
    billing: channelSchema,
    usage: channelSchema,
    summary: channelSchema,
  })
  .strict();

/** ニュースのメール通知だけを切り替える入力（T-M8-407）。 */
export const newsEmailNotificationSchema = z.object({ email: z.boolean() }).strict();

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
      .min(1, "テーマを1件以上選択してください。")
      .refine(unique, "テーマが重複しています。"),
    impact_filter: z
      .array(impactLevelSchema)
      .min(1, "インパクトを1件以上選択してください。")
      .refine(unique, "インパクトが重複しています。"),
  })
  // 過去に保存された max_items 等の旧キーは黙って落とす（T-M8-187で表示件数を廃止。
  // strictにすると旧データのparseが失敗し、テーマ・インパクトまで既定へ戻ってしまう）。
  .strip();


export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
/** 保存の入力（ニュースの `email` は省略可）。 */
export type NotificationConfigInput = z.infer<typeof notificationConfigSchema>;
/** 読み出した設定（ニュースの `email` は必ず埋まる）。 */
export type NotificationConfig = {
  [T in Exclude<NotificationType, "news">]: { in_app: boolean };
} & { news: { in_app: boolean; email: boolean } };
export type NewsConfig = z.infer<typeof newsConfigSchema>;

/** 通知設定を読み出す。未設定/不正は種別ごとに §3.4 既定値へフォールバックする。 */
export function resolveNotificationConfig(raw: unknown): NotificationConfig {
  const parsed = notificationConfigSchema.safeParse(raw);
  const source: Record<string, unknown> = parsed.success
    ? parsed.data
    : ((raw ?? {}) as Record<string, unknown>);
  const out: Record<string, { in_app: boolean; email?: boolean }> = {};
  for (const type of NOTIFICATION_TYPES) {
    if (type === "news") continue;
    const channel = channelSchema.safeParse(source[type]);
    out[type] = channel.success ? channel.data : { in_app: DEFAULT_NOTIFICATION_CONFIG[type].in_app };
  }
  const news = newsChannelInputSchema.safeParse(source.news);
  out.news = {
    in_app: news.success ? news.data.in_app : DEFAULT_NOTIFICATION_CONFIG.news.in_app,
    email: news.success
      ? (news.data.email ?? DEFAULT_NOTIFICATION_CONFIG.news.email)
      : DEFAULT_NOTIFICATION_CONFIG.news.email,
  };
  return out as NotificationConfig;
}

/** ニュース設定を読み出す。未設定/不正は §3.4 既定値へフォールバックする。 */
export function resolveNewsConfig(raw: unknown): NewsConfig {
  const parsed = newsConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return {
    categories: [...DEFAULT_NEWS_CONFIG.categories],
    impact_filter: [...DEFAULT_NEWS_CONFIG.impact_filter],
  };
}

export interface UserSettings {
  notificationConfig: NotificationConfig;
  newsConfig: NewsConfig;
}

export async function readSettings(
  db: Queryable,
  userId: string,
): Promise<UserSettings | null> {
  const { rows } = await db.query<{
    notification_config: unknown;
    news_config: unknown;
  }>(
    `select notification_config, news_config from profiles where id = $1`,
    [userId],
  );
  if (!rows[0]) return null;
  return {
    notificationConfig: resolveNotificationConfig(rows[0].notification_config),
    newsConfig: resolveNewsConfig(rows[0].news_config),
  };
}


/**
 * 通知設定を保存する。**ニュースの `email` が入力に無ければ保存済みの値を保つ**（T-M8-407）。
 * アプリ内通知の画面は in_app だけを送るため、そこで保存してもメールONが外れない。
 */
export async function saveNotificationConfig(
  db: Queryable,
  userId: string,
  config: NotificationConfigInput,
): Promise<void> {
  await db.query(
    `update profiles
        set notification_config = jsonb_set(
              $2::jsonb, '{news,email}',
              to_jsonb(coalesce(($2::jsonb->'news'->>'email')::boolean,
                                (notification_config->'news'->>'email')::boolean,
                                false)),
              true),
            updated_at = now()
      where id = $1`,
    [userId, JSON.stringify(config)],
  );
}

/** ニュースのメール通知（ON/OFF）だけを書き換える（T-M8-407）。他の種別・in_app は触らない。 */
export async function saveNewsEmailNotification(
  db: Queryable,
  userId: string,
  email: boolean,
): Promise<void> {
  await db.query(
    `update profiles
        set notification_config = jsonb_set(
              jsonb_set(coalesce(notification_config, '{}'::jsonb), '{news}',
                        coalesce(notification_config->'news', '{}'::jsonb), true),
              '{news,email}', to_jsonb($2::boolean), true),
            updated_at = now()
      where id = $1`,
    [userId, email],
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

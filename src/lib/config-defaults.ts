/**
 * Default JSONB config values applied at profile creation (要件06 §3.4, 要件02
 * §4.3/§4.4). ai_purpose_config starts empty and is filled when API keys are
 * saved (要件02 §4.1).
 */

export const DEFAULT_NOTIFICATION_CONFIG = {
  news: { in_app: true, email: true },
  draft_created: { in_app: true, email: true },
  posted: { in_app: true, email: false },
  error: { in_app: true, email: true },
  billing: { in_app: true, email: true },
  usage: { in_app: true, email: true },
  /** 日次サマリ（T-M7-29）。1日1通なのでメールも既定ON（見に行かなくても気付ける形）。 */
  summary: { in_app: true, email: true },
} as const;

export const DEFAULT_NEWS_CONFIG = {
  // **取得している分野だけ**を既定にする（T-M7-55）。取得しない分野を既定に入れると、
  // 新規利用者は最初から「設定はあるのに記事が来ない」状態になる。
  // ここは**通知の対象条件**（一覧はT-M8-188から新着順の最新500件・50件ずつのページ表示）。
  categories: ["ai", "web3", "sns", "investment", "love", "beauty"],
  impact_filter: ["high", "mid"],
} as const;

export const DEFAULT_AI_PURPOSE_CONFIG = {
  text: null,
  image: null,
} as const;

/*
 * 表示件数（max_items・NEWS_MAX_ITEMS_MIN/MAX・clampNewsMaxItems）はT-M8-187で廃止した。
 * ニュース一覧は最新500件・50件ずつのページ表示（`NEWS_PAGE_SIZE`・news-items.ts）。
 * 旧保存値はmigration 20260821000002でnews_configから取り除いた。
 */

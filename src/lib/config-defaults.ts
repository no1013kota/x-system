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
  categories: ["ai", "investment", "sns"],
  impact_filter: ["high", "mid"],
  max_items: 20,
} as const;

export const DEFAULT_AI_PURPOSE_CONFIG = {
  text: null,
  image: null,
} as const;

/**
 * ニュースの表示件数の範囲（要件05 §4.1 の `max_items`・T-M8-37）。
 *
 * **画面とサーバー検証で同じ値を使う。** 以前は `settings.ts` の zod（1〜100）と、2つの画面の
 * `min`/`max` 属性に同じ数字が3回書かれていた。設定画面はクランプしておらず、欄を空にすると
 * `Number("")` で 0 が送られ、`z.number().min(1)` で弾かれて「入力内容を確認してください」という
 * **どの項目が悪いか分からない**エラーになっていた。ニュース一覧の同じ欄はクランプ済みで、
 * 同じ設定項目が画面によって挙動が違った。
 */
export const NEWS_MAX_ITEMS_MIN = 1;
export const NEWS_MAX_ITEMS_MAX = 100;

/** 範囲内へ丸める。数値にならない入力（空文字など）は下限へ寄せる。 */
export function clampNewsMaxItems(value: number): number {
  if (!Number.isFinite(value)) return NEWS_MAX_ITEMS_MIN;
  return Math.min(NEWS_MAX_ITEMS_MAX, Math.max(NEWS_MAX_ITEMS_MIN, Math.trunc(value)));
}

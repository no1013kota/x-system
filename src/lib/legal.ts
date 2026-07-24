/**
 * Legal document versions saved with explicit signup consent.
 * Replace these draft versions when the release copy receives legal approval.
 */
export const CURRENT_TERMS_VERSION = "2026-07-22-draft";
export const CURRENT_PRIVACY_VERSION = "2026-07-22-draft";

/**
 * 自動投稿の明示同意で保存する説明文version（要件02 §3.3, 要件05 §7）。
 * 有効な同意は automation_consent_version がこの値と一致し、consented_at 非null かつ disabled_at null。
 * 説明文を改訂したら更新する（既存同意は無効化され再同意が必要になる）。
 */
export const CURRENT_AUTOMATION_CONSENT_VERSION = "2026-07-22-draft";

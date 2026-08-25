/**
 * Legal document versions saved with explicit signup consent.
 *
 * 形式は `YYYY-MM-DD`（`consentVersionLabel` が「2026年8月8日版」へ変換して表示する）。
 * **文面を改訂したら必ずこの値を上げる**——値が変わると `requireExecutionAccess` が
 * 生成・投稿・自動実行の前に再同意を要求する（利用規約「本規約の変更」の裏付け）。
 * `-draft` のような内部向け接尾辞は付けない（利用者に露出する・T-M8-72）。
 */
export const CURRENT_TERMS_VERSION = "2026-08-20";
export const CURRENT_PRIVACY_VERSION = "2026-08-20";

/**
 * 自動投稿の明示同意で保存する説明文version（要件02 §3.3, 要件05 §7）。
 * 有効な同意は automation_consent_version がこの値と一致し、consented_at 非null かつ disabled_at null。
 * 説明文を改訂したら更新する（既存同意は無効化され再同意が必要になる）。
 */
export const CURRENT_AUTOMATION_CONSENT_VERSION = "2026-08-08";

/**
 * 同意versionの利用者向け表記（要件06 §3.5）。内部値（"2026-07-22-draft" 等）をそのまま
 * 見せると意味が伝わらず、リリース前の `-draft` も露出するため日付表記へ変換する。
 */
export function consentVersionLabel(version: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(version);
  if (!match) return version;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日版`;
}

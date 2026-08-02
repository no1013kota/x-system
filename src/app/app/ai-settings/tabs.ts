/**
 * SC-10 AI設定のタブ（要件06 §9）。
 *
 * **画面とリンク元で同じ定義を使う**（T-M8-18）。トーストやエラーから「AI用途を開く」のような
 * 導線を張るとき、slug を文字列で書くと**存在しないタブへ飛んでも何も起きず**（不正な値は
 * 先頭タブへ丸められる）、壊れたことに気付けない。ここを唯一の定義にする。
 */

export const AI_SETTINGS_TABS = [
  ["persona", "発信設定"],
  ["purposes", "AI用途"],
  ["learning", "学習ソース"],
  ["base-md", "ベースmd"],
  ["prompts", "プロンプト"],
] as const;

export type AiSettingsTab = (typeof AI_SETTINGS_TABS)[number][0];

/** タブを開くURL。slug は型で縛るので綴り間違いはコンパイルで落ちる。 */
export function aiSettingsTabHref(tab: AiSettingsTab): string {
  return `/app/ai-settings?tab=${tab}`;
}

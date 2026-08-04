/**
 * SC-08 設定のタブ（要件06 §3）。定義を1か所に置く理由は
 * `app/ai-settings/tabs.ts` と同じ（T-M8-18）。
 */

export const SETTINGS_TABS = [
  ["x-accounts", "Xアカウント"],
  ["api-keys", "APIキー"],
  ["notifications", "通知"],
  ["billing", "課金・プラン"],
  ["support", "問い合わせ"],
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

/** タブを開くURL。slug は型で縛るので綴り間違いはコンパイルで落ちる。 */
export function settingsTabHref(tab: SettingsTab): string {
  return `/app/settings?tab=${tab}`;
}

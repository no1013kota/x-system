/**
 * メールアドレス確認の6桁コード（T-M8-121）。
 *
 * **リンク方式をやめてコード方式にした理由**（2026-08-18 運営者の指示）。リンクは
 * 「面倒で離脱する」うえに、壊れ方が多い:
 * - メールクライアントがURLを先読みして**1回きりのトークンを使い切る**（利用者が押すと「使用済み」）
 * - リモートのテンプレートが既定のままだと `token_hash` が付かず必ず失敗する（T-M8-120で2回踏んだ）
 * - スマホでメールを開くと、登録した端末と別のブラウザで開くことになる
 *
 * コードなら**画面を離れずに入力できる**ので、上のどれも起きない。
 * 検証は Supabase の `verifyOtp({ email, token, type: "signup" })` が行う（コードの生成・期限・
 * 使い切りはSupabase側の責務で、アプリは持たない）。
 */

/** Supabase の既定のコード長。テンプレートの `{{ .Token }}` がこの桁数で入る。 */
export const EMAIL_CODE_LENGTH = 6;

/**
 * 入力されたコードを整える。
 *
 * **メールからコピーすると前後の空白や全角数字が混ざる。** そのまま送ると Supabase が
 * `invalid` を返し、利用者には「コードが違います」と出る——本人は正しく写しているので
 * 直せない。ここで吸収する（原則1: 直せない失敗を作らない）。
 */
export function normalizeEmailCode(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, "");
}

/** 整えたコードが検証にかけられる形か。 */
export function isEmailCodeComplete(raw: string): boolean {
  return normalizeEmailCode(raw).length === EMAIL_CODE_LENGTH;
}

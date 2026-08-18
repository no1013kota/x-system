/**
 * Supabase Auth の設定値と認証メールのテンプレート定義（T-M8-144）。
 *
 * **`push-auth-templates.mjs` から切り出した。** あの script は CLI で、読み込むだけで
 * `--target` を要求して `process.exit(1)` するため、**テストから import できなかった**。
 * その結果「必ず一致させる」と書いてあった相手（`config.toml`・アプリのコード定数）と
 * 機械的に照合できていなかった。値の正本はここ1か所で、照合は
 * `src/lib/auth/auth-settings-sync.test.ts` が行う。
 */

export const TEMPLATES = [
  {
    label: "Confirm signup",
    file: "supabase/templates/confirmation.html",
    subjectKey: "mailer_subjects_confirmation",
    contentKey: "mailer_templates_confirmation_content",
    subject: "Exos AIのメールアドレス確認",
    requires: "Token",
    brokenHint:
      "確認コード（{{ .Token }}）が本文にありません。このままでは登録画面に入力するコードが届きません",
  },
  {
    label: "Reset password",
    file: "supabase/templates/recovery.html",
    subjectKey: "mailer_subjects_recovery",
    contentKey: "mailer_templates_recovery_content",
    subject: "Exos AIのパスワード再設定",
    requires: "TokenHash",
    brokenHint:
      "token_hash がリンクに付いていません（このままでは必ず「リンクを確認できませんでした」になります）",
  },
];

export const AUTH_SETTINGS = {
  /** 確認コードの桁数。`EMAIL_CODE_LENGTH`（画面側）と必ず一致させる。 */
  mailer_otp_length: 6,
  /** コードの有効期間（秒）。画面の案内文（1時間）と合わせる。 */
  mailer_otp_exp: 3600,
  /**
   * 1時間に送れるメール数。既定の2は**動作確認すら通らない**（登録＋再送で使い切る）。
   * カスタムSMTP前提で30へ。総当たりの入口を広げすぎない範囲で、利用者が詰まらない値。
   */
  rate_limit_email_sent: 30,
  /**
   * 5分あたりのコード検証回数（IPごと）。**総当たり対策の本体**。
   * 6桁＝100万通りに対して5分30回なので、現実的な時間では当たらない。
   * 打ち間違いを数回する利用者は困らない値（Supabaseの既定と同じ）。
   */
  rate_limit_verify: 30,
  /** 5分あたりの登録・ログイン試行（IPごと）。 */
  rate_limit_anonymous_users: 30,
};

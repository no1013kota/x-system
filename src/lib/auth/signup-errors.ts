/**
 * 登録の失敗を、利用者が次に何をすればよいか分かる文言へ振り分ける（T-M8-127）。
 *
 * 以前はcaptcha以外すべて「登録を完了できませんでした。入力内容を確認し、時間をおいて再度
 * お試しください。」に丸めていた。**登録済みのアドレスは待っても直らない**ので、この文言は
 * 嘘になり、利用者は同じ操作を繰り返す（CLAUDE.md 原則1・2）。
 *
 * Supabase（GoTrue）の実際の応答をローカルで確かめて作った（2026-08-18）:
 * - 確認済みメールで再登録 → 422 `user_already_exists`
 * - **未確認**メールで再登録 → エラーにならず、確認コードが再送される（そのまま成功で扱ってよい）
 * - 短時間に連続 → 429 `over_email_send_rate_limit`
 * - 送信上限（1時間あたり）超過 → 429 `over_email_send_rate_limit`
 *
 * ## アカウント列挙について
 *
 * 「登録済み」と明示すると、第三者が任意のアドレスの登録有無を判別できる（列挙）。
 * 運営者の指示（2026-08-18）で明示する。**得られる情報を実質増やさない**ため、
 * 文言はログイン・パスワード再設定への案内に寄せる——ログイン画面は元々
 * 「登録済みかどうか」を答えないので、ここだけを塞いでも意味が薄い。
 * 自動列挙はTurnstileと `rate_limit_anonymous_users`（5分30回）が抑える。
 */

/** 画面へ出す文言。`action` があれば導線を添える。 */
export interface SignUpErrorMessage {
  message: string;
  /** 添える導線。無ければ文言だけ。 */
  action?: { href: string; label: string };
}

/** 原因を特定できなかったときの文言（従来どおり）。 */
export const SIGNUP_GENERIC_ERROR: SignUpErrorMessage = {
  message: "登録を完了できませんでした。入力内容を確認し、時間をおいて再度お試しください。",
};

/**
 * Supabaseのエラーから安定コードを取り出す。
 *
 * `code`（新しめのSDK）と `error_code`（RESTの生応答）の両方を見る。**片方だけ見ると
 * 経路によって取りこぼす**。`status` も拾って429の判定に使う。
 */
export function authErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as Record<string, unknown>;
  for (const key of ["code", "error_code"]) {
    const value = e[key];
    if (typeof value === "string" && value !== "") return value;
  }
  // コードが無い実装でもレート制限だけは status から分かる。
  if (e.status === 429) return "over_email_send_rate_limit";
  return null;
}

/** 登録時のエラーを文言へ振り分ける。判定できないものは汎用文へ落とす。 */
export function signUpErrorMessage(error: unknown): SignUpErrorMessage {
  switch (authErrorCode(error)) {
    case "user_already_exists":
    case "email_exists":
      return {
        message:
          "このメールアドレスは既に登録されています。ログイン、またはパスワードをお忘れの場合は再設定してください。",
        action: { href: "/login", label: "ログイン画面へ" },
      };
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      // **「入力内容を確認」と言わない**——入力は正しいのに直せと言うことになる。
      return {
        message:
          "確認メールの送信が続いたため、いまは受け付けられません。数分おいてからもう一度お試しください。",
      };
    case "weak_password":
      return { message: "パスワードが単純すぎます。別のパスワードを設定してください。" };
    case "email_address_invalid":
    case "validation_failed":
      return { message: "メールアドレスの形式を確認してください。" };
    default:
      return SIGNUP_GENERIC_ERROR;
  }
}

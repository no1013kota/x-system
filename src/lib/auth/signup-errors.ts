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

/** 「既に登録されている」ときの文言。**エラー経路と成功経路の両方から使う**（T-M8-149）。 */
export const SIGNUP_ALREADY_REGISTERED: SignUpErrorMessage = {
  message:
    "このメールアドレスは既に登録されています。ログイン、またはパスワードをお忘れの場合は再設定してください。",
  action: { href: "/login", label: "ログイン画面へ" },
};

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
      return SIGNUP_ALREADY_REGISTERED;
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

/**
 * 登録が**エラー無しで返ってきたとき**に、本当に確認コードが送られたのかを判定する（T-M8-149）。
 *
 * ## なぜ必要か
 *
 * 2026-08-18、本番で登録済みのアドレスを入力すると**エラーにならずコード入力画面へ進み、
 * メールは永久に来なかった**。Supabase（ホスト版）はアカウント列挙を防ぐため、
 * **登録済みでも成功と同じ形の応答を返してメールを送らない**。
 * 応答は `identities` が空配列になるのが目印（Supabaseが公開している判別方法）。
 *
 * ローカルのSupabaseは同じ状況で `user_already_exists` を返すため、
 * **エラーコードだけを見ていると本番でだけ通り抜ける**。両方を見る。
 *
 * ## 判定の順序
 *
 * 0. **セッションが返っている → 新規登録**（メール確認省略中（T-M8-202・mailer_autoconfirm）は
 *    新規でも `email_confirmed_at` が即座に入るため、confirmed_atより先に見る。
 *    列挙対策の偽装応答は決してセッションを持たない）
 * 1. `identities` が空 → 登録済み（列挙対策の応答）
 * 2. `email_confirmed_at` が入っている → 登録済みで確認も完了している
 *    （確認必須モードの新規登録では確認前なので必ず空。入っていれば既存アカウント）
 * 3. それ以外 → 送られたものとして進む（未確認アドレスの再登録はSupabaseが毎回再送する）
 */
export interface SignUpUserFacts {
  identities?: unknown[] | null;
  email_confirmed_at?: string | null;
  /** signUp応答にセッションが付いていたか（autoconfirm時の新規はtrue・T-M8-202）。 */
  hasSession?: boolean;
}

export type SignUpVerdict = "created" | "already_registered";

export function classifySignUpUser(user: SignUpUserFacts | null | undefined): SignUpVerdict {
  if (!user) return "already_registered";
  if (user.hasSession) return "created";
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    return "already_registered";
  }
  if (typeof user.email_confirmed_at === "string" && user.email_confirmed_at !== "") {
    return "already_registered";
  }
  return "created";
}

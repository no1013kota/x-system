/**
 * Error → user-facing conversion (要件01 §8, 要件05 §2.2). User-facing output
 * carries only a stable code and a safe Japanese message — never a stack trace
 * or a provider response body. Internal detail stays for logging/Sentry only.
 */

/** Stable error codes shared with the API/Action error contract (要件05 §2.2). */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation_error"
  | "legal_consent_required"
  | "automation_consent_required"
  | "subscription_required"
  | "usage_limit_exceeded"
  | "usage_paused"
  | "x_account_required"
  | "api_key_required"
  | "persona_required"
  | "feature_disabled"
  | "provider_error"
  | "post_state_unknown"
  | "job_conflict"
  | "not_found"
  | "internal_error";

const USER_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "ログインが必要です。",
  forbidden: "この操作を実行する権限がありません。",
  validation_error: "入力内容を確認してください。",
  // **どこへ行けば直るかを書く**（T-M8-134）。以前は「ご確認ください」だけで、
  // 同意画面への導線も無かったため、生成も投稿もスケジュール保存も止まったまま
  // 利用者には打つ手が無かった。画面上部には再同意バナーが常設で出ている。
  legal_consent_required:
    "利用規約・プライバシーポリシーが更新されています。画面上部の案内から同意してください。",
  automation_consent_required: "自動投稿を有効にするには、現在の説明への同意が必要です。",
  subscription_required: "現在のご契約状態ではこの操作を実行できません。",
  usage_limit_exceeded: "今月の利用上限に達しています。",
  /**
   * 利用枠を画面に出さないプラン（エキスパート）の上限到達（T-M8-168）。
   * **上限・残量の数値をこの文言にも details にも載せない**（内部ガード値を悟らせない）。
   * 文言は運営者の指定どおり（2026-08-20）。
   */
  usage_paused: "連続的な使用が検知されたため一時的に停止しております。お待ちください。",
  x_account_required: "Xアカウントの連携が必要です。",
  api_key_required: "APIキーの登録が必要です。",
  persona_required: "アカウント設定の保存が必要です。",
  feature_disabled: "この機能は現在ご利用いただけません。",
  provider_error: "外部サービスとの通信に失敗しました。時間をおいて再度お試しください。",
  post_state_unknown: "投稿の結果を確認できませんでした。Xでご確認ください。",
  job_conflict: "処理が競合しました。最新の状態を再読み込みしてください。",
  not_found: "対象が見つかりません。",
  internal_error: "予期しないエラーが発生しました。",
};

/**
 * Application error carrying a user-safe code. `cause`/details are for internal
 * logging only and must not be shown to users.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options?: { message?: string; cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(options?.message ?? code, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options?.details;
  }
}

export interface UserFacingError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Converts any thrown value into a safe {code, message} for the client. Unknown
 * errors collapse to `internal_error` so provider bodies / stack traces never
 * leak. `details` is only included for AppError (author-controlled, non-secret).
 */
export function toUserFacingError(error: unknown): UserFacingError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: USER_MESSAGES[error.code],
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return { code: "internal_error", message: USER_MESSAGES.internal_error };
}

export function userMessageForCode(code: ErrorCode): string {
  return USER_MESSAGES[code];
}

/** 任意の値が既知の ErrorCode か判定する（外部由来のcodeをそのまま信用しないため）。 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(USER_MESSAGES, value);
}

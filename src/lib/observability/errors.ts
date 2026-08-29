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

/**
 * 利用者に見せる文言。**「何が起きたか」だけで終わらせず「次に何をすればよいか」を書く**
 * （T-M8-134→T-M8-329）。運営者は非エンジニアの利用者を相手にするので、
 * 「予期しないエラーが発生しました」だけでは問い合わせにしかならない（CLAUDE.md 原則2）。
 *
 * **内部の値を混ぜない**——上限・残量・providerの生文言・IDはここにもdetailsにも載せない。
 */
const USER_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "ログインが必要です。もう一度ログインしてからお試しください。",
  forbidden: "この操作は許可されていません。別のアカウントのデータを開いていないかご確認ください。",
  // 具体的な理由は書き手が AppError の message に載せる（D-26の sentinel方式）。ここは最後の受け皿。
  validation_error: "入力内容に誤りがあります。赤くなっている項目を確認してください。",
  // **どこへ行けば直るかを書く**（T-M8-134）。以前は「ご確認ください」だけで、
  // 同意画面への導線も無かったため、生成も投稿もスケジュール保存も止まったまま
  // 利用者には打つ手が無かった。画面上部には再同意バナーが常設で出ている。
  legal_consent_required:
    "利用規約・プライバシーポリシーが更新されています。画面上部の案内から同意してください。",
  automation_consent_required:
    "自動投稿を有効にするには、現在の説明への同意が必要です。スケジュール画面の案内から同意してください。",
  subscription_required:
    "この操作にはプランのご登録が必要です。設定の「課金・プラン」から手続きしてください。",
  usage_limit_exceeded:
    "今の契約期間の利用上限に達しています。次回の更新日にリセットされますので、それまでお待ちください。",
  /**
   * 利用枠を画面に出さないプラン（エキスパート）の上限到達（T-M8-168）。
   * **上限・残量の数値をこの文言にも details にも載せない**（内部ガード値を悟らせない）。
   * 文言は運営者の指定どおり（2026-08-20）。
   */
  usage_paused: "連続的な使用が検知されたため一時的に停止しております。お待ちください。",
  x_account_required: "Xアカウントの連携が必要です。設定の「設定」タブから連携してください。",
  api_key_required: "APIキーの登録が必要です。設定の「設定」タブから登録してください。",
  persona_required:
    "先にアカウント設定（あなたの発信内容の定義）を保存してください。設定の「アカウント設定」タブから登録できます。",
  feature_disabled:
    "この機能はいまご利用いただけません。ご契約のプランをお確かめのうえ、お問い合わせください。",
  provider_error:
    "AIサービスとの通信に失敗しました。少し時間をおいてもう一度お試しください（何度も続くときはお問い合わせください）。",
  post_state_unknown: "投稿の結果を確認できませんでした。Xでご確認ください。",
  job_conflict:
    "ほかの操作と重なりました。画面を再読み込みしてから、もう一度お試しください。",
  not_found:
    "対象が見つかりませんでした。削除されたか、リンクが古い可能性があります。一覧から開き直してください。",
  internal_error:
    "処理に失敗しました。少し時間をおいてもう一度お試しください（続くときはお問い合わせください）。",
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

/**
 * 既知のコード一覧。**文言の検査が全コードを漏れなく回る**ために公開する（T-M8-329）。
 * コードを足したら文言も足すことが、この一覧経由の検査で担保される。
 */
export const ALL_ERROR_CODES = Object.keys(USER_MESSAGES) as ErrorCode[];

/** 任意の値が既知の ErrorCode か判定する（外部由来のcodeをそのまま信用しないため）。 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(USER_MESSAGES, value);
}

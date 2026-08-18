"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { safeAuthNext } from "@/lib/auth/confirm";
import {
  ATTEMPTS_WARN_AT,
  clearCodeAttempts,
  codeAttemptState,
  recordCodeFailure,
} from "@/lib/auth/code-attempts";
import { EMAIL_CODE_LENGTH, normalizeEmailCode } from "@/lib/auth/email-code";
import {
  classifySignUpUser,
  SIGNUP_ALREADY_REGISTERED,
  SIGNUP_GENERIC_ERROR,
  signUpErrorMessage,
} from "@/lib/auth/signup-errors";
import { captchaTokenSchema, emailSchema } from "@/lib/auth/form-schemas";
import { authoredFieldErrors, parseUserInput } from "@/lib/validation/user-input";
import { ensureUserProfileWithClient } from "@/lib/auth/profile-core";
import {
  passwordResetRequestInputFromFormData,
  RECOVERY_SESSION_COOKIE,
  updatePasswordInputFromFormData,
  verifyRecoverySession,
} from "@/lib/auth/recovery";
import { signInInputFromFormData } from "@/lib/auth/signin";
import { signUpInputFromFormData } from "@/lib/auth/signup";
import { canBrowseApp } from "@/lib/auth/subscription-access";
import { getAppEncryptionKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { AuthFormState } from "./auth-state";
import { recordUnexpectedError } from "@/lib/observability/sentry";
import { confirmRedirectUrl } from "@/lib/ops/auth-url-status";

const SIGNUP_ACCEPTED_MESSAGE =
  "確認コードをメールで送信しました。届いた6桁の数字を入力してください。";
/**
 * コードが違う・期限切れのときの文言（T-M8-121）。
 * **どちらか一方に絞らない**——Supabaseはどちらも同じ `invalid` 系で返すため、
 * 断定すると片方の利用者に嘘を言うことになる。次にやることだけを明確にする。
 */
const CODE_INVALID_MESSAGE =
  "コードが確認できませんでした。入力を確認するか、コードを再送してください（発行から1時間で期限切れになります）。";
/**
 * 連続失敗の上限に達したとき（T-M8-124）。**行き止まりにしない**——次にやること（再送）を示す。
 * 再送すれば数えは戻る。
 */
const CODE_BLOCKED_MESSAGE =
  "入力の失敗が続いたため、いまのコードでは確認できません。「コードを再送」してから、新しいコードを入力してください。";
/**
 * 原因を特定できないときの文言。**正本は `signup-errors.ts`**（画面へ出す文言を1か所にまとめる）。
 * 原因が分かるものは `signUpErrorMessage` が言い分ける（T-M8-127）。
 */
const SIGNUP_ERROR_MESSAGE = SIGNUP_GENERIC_ERROR.message;
const RESEND_ACCEPTED_MESSAGE =
  "確認メールを再送しました。登録可能なメールアドレスの場合にメールが届きます。";
const SIGNIN_ERROR_MESSAGE =
  "ログインできませんでした。入力内容を確認し、時間をおいて再度お試しください。";
const RESET_REQUEST_ACCEPTED_MESSAGE =
  "再設定メールを受け付けました。登録可能なメールアドレスの場合にメールが届きます。";
const UPDATE_PASSWORD_ERROR_MESSAGE =
  "パスワードを更新できませんでした。再設定メールをもう一度申請してください。";
const CAPTCHA_ERROR_MESSAGE =
  "人間であることの確認に失敗しました。もう一度お試しください。";

/**
 * 確認メールのリンクの行き先。
 *
 * **`doctor` が許可リストを検査するのと同じ関数を使う**（T-M8-144）。
 * 以前はここに同じ組み立ての写しがあり、コメントで「同じにすること」と人の記憶に
 * 頼っていた——片方だけ変えると「doctorは緑なのにメールのリンクが通らない」になる。
 */
function confirmationRedirectUrl(): string {
  return confirmRedirectUrl(env.APP_BASE_URL as string);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

/** Registers a pending email user and records the exact legal versions accepted. */
export async function signUp(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpInputFromFormData(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "入力内容を確認してください。",
      fieldErrors: authoredFieldErrors(parsed.error),
    };
  }

  const input = parsed.data;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: confirmationRedirectUrl(),
        ...(input.captcha_token
          ? { captchaToken: input.captcha_token }
          : {}),
      },
    });

    if (hasErrorCode(error, "captcha_failed")) {
      return { status: "error", message: CAPTCHA_ERROR_MESSAGE };
    }
    if (error || !data.user) {
      // **原因ごとに言い分ける**（T-M8-127）。登録済みは待っても直らないので
      // 「時間をおいて再度」と言ってはいけない（同じ操作を繰り返させる）。
      const { message, action } = signUpErrorMessage(error);
      return { status: "error", message, ...(action ? { action } : {}) };
    }

    /*
      **エラーが無くても登録済みのことがある**（T-M8-149）。ホスト版のSupabaseはアカウント
      列挙を防ぐため、登録済みのアドレスでも成功と同じ形の応答を返し、**メールを送らない**。
      ここを素通りさせると、来ないコードを待つ画面へ利用者を送り込むことになる
      （2026-08-18に本番で発生。ローカルのSupabaseは同じ状況でエラーを返すため気付けなかった）。
    */
    if (classifySignUpUser(data.user) === "already_registered") {
      return {
        status: "error",
        message: SIGNUP_ALREADY_REGISTERED.message,
        ...(SIGNUP_ALREADY_REGISTERED.action ? { action: SIGNUP_ALREADY_REGISTERED.action } : {}),
      };
    }

    const acceptedAt = new Date().toISOString();
    const admin = createSupabaseAdminClient();
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        privacy_acknowledged_at: acceptedAt,
        privacy_version: CURRENT_PRIVACY_VERSION,
        terms_accepted_at: acceptedAt,
        terms_version: CURRENT_TERMS_VERSION,
      })
      .eq("id", data.user.id);

    if (profileError) {
      return { status: "error", message: SIGNUP_ERROR_MESSAGE };
    }

    return {
      status: "success",
      message: SIGNUP_ACCEPTED_MESSAGE,
      email: input.email,
    };
  } catch (error) {
    recordUnexpectedError(error, { at: "sign-up" });
    return { status: "error", message: SIGNUP_ERROR_MESSAGE };
  }
}

/** Resends signup confirmation without revealing whether the email exists. */
/**
 * メールで届いた6桁コードを検証して、登録を完了する（T-M8-121）。
 *
 * 成功すると Supabase がセッションを張るので、そのまま `/plans` へ進める（**確認のためだけに
 * もう一度ログインさせない**）。`verifyOtp` はコードの期限・使い切りをSupabase側で管理する。
 *
 * captchaはここでは要求しない。**このフォームに到達できるのは直前に登録した本人だけ**で、
 * すでに登録時にTurnstileを通している。ここで再度求めると、コードを打つだけの画面で
 * 人間確認が失敗して詰む経路を増やす（T-M8-87の教訓）。
 */
export async function verifySignUpCode(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const emailResult = parseUserInput(emailSchema, formData.get("email"));
  if (!emailResult.success) {
    return { status: "error", message: "メールアドレスを確認してください。" };
  }
  const email = emailResult.data;
  const code = normalizeEmailCode(String(formData.get("code") ?? ""));
  if (code.length !== EMAIL_CODE_LENGTH) {
    return {
      status: "error",
      message: `${EMAIL_CODE_LENGTH}桁の数字を入力してください。`,
      email,
    };
  }

  // 執念深い試行を止める（T-M8-124）。打ち間違いの数回では何も起きない。
  if (codeAttemptState(email).blocked) {
    return { status: "error", message: CODE_BLOCKED_MESSAGE, email };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });
    if (error || !data.user) {
      const { blocked, remaining } = recordCodeFailure(email);
      return {
        status: "error",
        message: blocked
          ? CODE_BLOCKED_MESSAGE
          : // 残りは少なくなってから初めて出す（最初から出すと急かすだけ）。
            remaining <= ATTEMPTS_WARN_AT
            ? `${CODE_INVALID_MESSAGE}（あと${remaining}回で再送が必要になります）`
            : CODE_INVALID_MESSAGE,
        email,
      };
    }
    clearCodeAttempts(email);
    // profile行が無いまま進むと、同意の記録が無くて再同意を求める経路へ落ちる（T-M8-73）。
    // 登録時のtriggerで作られているはずだが、無ければここで作る（既存値は触らない）。
    await ensureUserProfileWithClient(data.user, createSupabaseAdminClient());
  } catch (error) {
    recordUnexpectedError(error, { at: "verify-signup-code" });
    return { status: "error", message: CODE_INVALID_MESSAGE, email };
  }

  // 確認できたことを着地側で言う（T-M8-58。無言で料金表に変わると成功したか分からない）。
  redirect("/plans?confirmed=1");
}

export async function resendSignUpConfirmation(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const emailResult = parseUserInput(emailSchema, formData.get("email"));
  if (!emailResult.success) {
    return {
      status: "error",
      message: "メールアドレスを確認してください。",
    };
  }

  const captchaResult = parseUserInput(captchaTokenSchema, formData.get("captcha_token"));
  if (!captchaResult.success) {
    return { status: "error", message: CAPTCHA_ERROR_MESSAGE };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resend({
      email: emailResult.data,
      type: "signup",
      options: {
        emailRedirectTo: confirmationRedirectUrl(),
        captchaToken: captchaResult.data,
      },
    });
    if (hasErrorCode(error, "captcha_failed")) {
      return { status: "error", message: CAPTCHA_ERROR_MESSAGE };
    }
    // 新しいコードを送ったので失敗の数えを戻す（上限に達した利用者を行き止まりにしない）。
    clearCodeAttempts(emailResult.data);
  } catch (error) {
    // 利用者へはアカウントの存在を漏らさないため常に同じ応答を返す（列挙防止）。
    // ただし原因を捨てるとメール送信不能が誰にも気付かれないため、記録だけは行う。
    recordUnexpectedError(error, { at: "resend-confirmation" });
  }

  return {
    status: "success",
    message: RESEND_ACCEPTED_MESSAGE,
    email: emailResult.data,
  };
}

/** Requests a recovery email without disclosing account existence. */
export async function requestPasswordReset(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = passwordResetRequestInputFromFormData(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "メールアドレスを確認してください。",
      fieldErrors: authoredFieldErrors(parsed.error),
    };
  }

  try {
    const input = parsed.data;
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
      redirectTo: confirmationRedirectUrl(),
      captchaToken: input.captcha_token,
    });
    if (hasErrorCode(error, "captcha_failed")) {
      return { status: "error", message: CAPTCHA_ERROR_MESSAGE };
    }
  } catch (error) {
    // 利用者へはアカウントの存在を漏らさないため常に同じ応答を返す（列挙防止）。
    // ただし原因を捨てるとメール送信不能が誰にも気付かれないため、記録だけは行う。
    recordUnexpectedError(error, { at: "password-reset-request" });
  }

  return {
    status: "success",
    message: RESET_REQUEST_ACCEPTED_MESSAGE,
    email: parsed.data.email,
  };
}

/** Updates a password only for the session established by a recovery link. */
export async function updatePassword(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = updatePasswordInputFromFormData(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "入力内容を確認してください。",
      fieldErrors: authoredFieldErrors(parsed.error),
    };
  }

  try {
    const cookieStore = await cookies();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { status: "error", message: UPDATE_PASSWORD_ERROR_MESSAGE };
    }

    verifyRecoverySession(
      cookieStore.get(RECOVERY_SESSION_COOKIE)?.value,
      getAppEncryptionKey(),
      { now: Date.now(), userId: data.user.id },
    );

    const { error: updateError } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (updateError) {
      return { status: "error", message: UPDATE_PASSWORD_ERROR_MESSAGE };
    }

    await supabase.auth.signOut({ scope: "local" });
    cookieStore.delete(RECOVERY_SESSION_COOKIE);
  } catch (error) {
    // 復号鍵の設定ミスとトークン期限切れが同じ文言になるため、原因は記録する。
    recordUnexpectedError(error, { at: "update-password" });
    return { status: "error", message: UPDATE_PASSWORD_ERROR_MESSAGE };
  }

  redirect("/login?password_updated=1");
}

/** Signs in a confirmed user and resolves the first authorized destination. */
export async function signIn(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInInputFromFormData(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "入力内容を確認してください。",
      fieldErrors: authoredFieldErrors(parsed.error),
    };
  }

  const input = parsed.data;
  let destination: string;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
      options: input.captcha_token
        ? { captchaToken: input.captcha_token }
        : undefined,
    });

    if (error) {
      if (hasErrorCode(error, "captcha_failed")) {
        return { status: "error", message: CAPTCHA_ERROR_MESSAGE };
      }
      if (hasErrorCode(error, "email_not_confirmed")) {
        return {
          status: "email_unconfirmed",
          message:
            "メールアドレスの確認が完了していません。確認メールを再送してください。",
          email: input.email,
        };
      }
      return { status: "error", message: SIGNIN_ERROR_MESSAGE };
    }
    if (!data.user) return { status: "error", message: SIGNIN_ERROR_MESSAGE };

    const admin = createSupabaseAdminClient();
    await ensureUserProfileWithClient(data.user, admin);
    const profile = await admin
      .from("profiles")
      .select("subscription_status")
      .eq("id", data.user.id)
      .single();
    if (profile.error || !profile.data) {
      // ここは service_role で profiles を読む経路。権限・接続の失敗が「入力内容を確認して」
      // という誤案内になり原因も残らないため必ず記録する（2026-07-26 のGRANT漏れと同型）。
      recordUnexpectedError(profile.error ?? new Error("profile not found after sign-in"), {
        at: "sign-in:profile",
        userId: data.user.id,
      });
      await supabase.auth.signOut();
      return { status: "error", message: SIGNIN_ERROR_MESSAGE };
    }

    destination = !canBrowseApp(profile.data.subscription_status)
      ? "/plans"
      : (safeAuthNext(input.next, env.APP_BASE_URL as string) ?? "/app");
  } catch (error) {
    // 認証情報の誤りは上の error 分岐で処理済み。ここへ来るのは想定外の失敗だけなので記録する。
    recordUnexpectedError(error, { at: "sign-in" });
    return { status: "error", message: SIGNIN_ERROR_MESSAGE };
  }

  redirect(destination);
}

/** Invalidates the Supabase session before returning the user to login. */
export async function signOut(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new AppError("internal_error", { cause: error });
  }

  redirect("/login");
}

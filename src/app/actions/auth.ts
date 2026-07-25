"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { safeAuthNext } from "@/lib/auth/confirm";
import { captchaTokenSchema, emailSchema } from "@/lib/auth/form-schemas";
import { ensureUserProfileWithClient } from "@/lib/auth/profile-core";
import {
  passwordResetRequestInputFromFormData,
  RECOVERY_SESSION_COOKIE,
  updatePasswordInputFromFormData,
  verifyRecoverySession,
} from "@/lib/auth/recovery";
import { signInInputFromFormData } from "@/lib/auth/signin";
import { signUpInputFromFormData } from "@/lib/auth/signup";
import { subscriptionAccessFor } from "@/lib/auth/subscription-access";
import { getAppEncryptionKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/legal";
import { AppError } from "@/lib/observability/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { AuthFormState } from "./auth-state";

const SIGNUP_ACCEPTED_MESSAGE =
  "確認メールを送信しました。メール内のリンクから登録を完了してください。";
const SIGNUP_ERROR_MESSAGE =
  "登録を完了できませんでした。入力内容を確認し、時間をおいて再度お試しください。";
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

function confirmationRedirectUrl(): string {
  return new URL("/auth/confirm", env.APP_BASE_URL).toString();
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
      fieldErrors: parsed.error.flatten().fieldErrors,
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
      return { status: "error", message: SIGNUP_ERROR_MESSAGE };
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
  } catch {
    return { status: "error", message: SIGNUP_ERROR_MESSAGE };
  }
}

/** Resends signup confirmation without revealing whether the email exists. */
export async function resendSignUpConfirmation(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const emailResult = emailSchema.safeParse(formData.get("email"));
  if (!emailResult.success) {
    return {
      status: "error",
      message: "メールアドレスを確認してください。",
    };
  }

  const captchaResult = captchaTokenSchema.safeParse(formData.get("captcha_token"));
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
  } catch {
    // Intentionally return the same accepted response for every provider result.
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
      fieldErrors: parsed.error.flatten().fieldErrors,
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
  } catch {
    // Account existence and provider failures intentionally share one response.
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
      fieldErrors: parsed.error.flatten().fieldErrors,
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
  } catch {
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
      fieldErrors: parsed.error.flatten().fieldErrors,
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
      await supabase.auth.signOut();
      return { status: "error", message: SIGNIN_ERROR_MESSAGE };
    }

    destination = subscriptionAccessFor(profile.data.subscription_status)
      ?.viewScope !== "app"
      ? "/plans"
      : (safeAuthNext(input.next, env.APP_BASE_URL as string) ?? "/app");
  } catch {
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

"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  resendSignUpConfirmation,
  signUp,
} from "@/app/actions/auth";
import {
  INITIAL_AUTH_FORM_STATE,
  type AuthFormState,
} from "@/app/actions/auth-state";
import { Button } from "@/components/ui/button";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

const inputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20";

function FieldError({ errors }: { errors: string[] | undefined }) {
  if (!errors?.length) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {errors[0]}
    </p>
  );
}
function ResultMessage({ state }: { state: AuthFormState }) {
  if (state.status === "idle") return null;
  return (
    <p
      className={
        state.status === "success"
          ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          : "rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
      }
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(
    signUp,
    INITIAL_AUTH_FORM_STATE,
  );
  const [resendState, resendAction, isResending] = useActionState(
    resendSignUpConfirmation,
    INITIAL_AUTH_FORM_STATE,
  );

  if (state.status === "success") {
    return (
      <section className="space-y-5" aria-labelledby="confirmation-heading">
        <div className="space-y-2">
          <h2 id="confirmation-heading" className="text-xl font-semibold">
            メールをご確認ください
          </h2>
          <ResultMessage state={state} />
        </div>
        <form action={resendAction} className="space-y-3">
          <input name="email" type="hidden" value={state.email ?? ""} />
          <input name="captcha_token" type="hidden" value="" />
          <Button type="submit" variant="outline" disabled={isResending}>
            {isResending ? "再送しています…" : "確認メールを再送"}
          </Button>
          <ResultMessage state={resendState} />
        </form>
        <p className="text-sm text-muted-foreground">
          メールが見つからない場合は迷惑メールフォルダをご確認ください。
        </p>
        <Link className="text-sm font-medium underline" href="/login">
          ログイン画面へ
        </Link>
      </section>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input name="terms_version" type="hidden" value={CURRENT_TERMS_VERSION} />
      <input
        name="privacy_version"
        type="hidden"
        value={CURRENT_PRIVACY_VERSION}
      />
      <input name="captcha_token" type="hidden" value="" />

      <ResultMessage state={state} />

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          メールアドレス
        </label>
        <input
          autoComplete="email"
          className={inputClassName}
          id="email"
          name="email"
          required
          type="email"
        />
        <FieldError errors={state.fieldErrors?.email} />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="password">
          パスワード
        </label>
        <input
          aria-describedby="password-help"
          autoComplete="new-password"
          className={inputClassName}
          id="password"
          maxLength={64}
          minLength={12}
          name="password"
          required
          type="password"
        />
        <p className="text-xs text-muted-foreground" id="password-help">
          12〜64文字、UTF-8で72バイト以内
        </p>
        <FieldError errors={state.fieldErrors?.password} />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="password-confirmation">
          パスワード（確認）
        </label>
        <input
          autoComplete="new-password"
          className={inputClassName}
          id="password-confirmation"
          maxLength={64}
          minLength={12}
          name="password_confirmation"
          required
          type="password"
        />
        <FieldError errors={state.fieldErrors?.password_confirmation} />
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-3 text-sm">
          <input
            className="mt-1 size-4"
            name="terms_accepted"
            required
            type="checkbox"
          />
          <span>
            <Link
              className="font-medium underline"
              href="/terms"
              rel="noopener noreferrer"
              target="_blank"
            >
              利用規約
            </Link>
            に同意します
          </span>
        </label>
        <FieldError errors={state.fieldErrors?.terms_accepted} />

        <label className="flex items-start gap-3 text-sm">
          <input
            className="mt-1 size-4"
            name="privacy_acknowledged"
            required
            type="checkbox"
          />
          <span>
            <Link
              className="font-medium underline"
              href="/privacy"
              rel="noopener noreferrer"
              target="_blank"
            >
              プライバシーポリシー
            </Link>
            を確認しました
          </span>
        </label>
        <FieldError errors={state.fieldErrors?.privacy_acknowledged} />
      </div>

      <Button className="h-11 w-full" disabled={isPending} type="submit">
        {isPending ? "登録しています…" : "メールアドレスで登録"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        すでにアカウントをお持ちですか？{" "}
        <Link className="font-medium text-foreground underline" href="/login">
          ログイン
        </Link>
      </p>
    </form>
  );
}

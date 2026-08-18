"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { signUp } from "@/app/actions/auth";
import {
  INITIAL_AUTH_FORM_STATE,
  type AuthFormState,
} from "@/app/actions/auth-state";
import { FieldError, authInputClassName } from "@/components/auth/field-error";
import { PasswordMatchHint, PasswordRulesHint } from "@/components/auth/password-hints";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import {
  PASSWORD_HELP_TEXT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-policy";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

function ResultMessage({ state }: { state: AuthFormState }) {
  if (state.status === "idle") return null;
  return (
    <Notice
      role={state.status === "error" ? "alert" : "status"}
      tone={state.status === "success" ? "success" : "danger"}
    >
      {state.message}
      {/*
        行き先が返ってきたら一緒に出す（T-M8-127）。「既に登録されています」だけでは
        次にどこへ行けばよいか分からず、同じフォームで再試行させてしまう。
      */}
      {state.action ? (
        <Link className="ml-1 font-medium underline underline-offset-4" href={state.action.href}>
          {state.action.label}
        </Link>
      ) : null}
    </Notice>
  );
}

export function SignUpForm() {
  const [state, formAction, isPending] = useActionState(
    signUp,
    INITIAL_AUTH_FORM_STATE,
  );
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");

  // 登録できたら、同じ画面でコード入力へ切り替える（T-M8-121。メールのリンクを追わせない）。
  if (state.status === "success" && state.email) {
    return <EmailCodeForm email={state.email} />;
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input name="terms_version" type="hidden" value={CURRENT_TERMS_VERSION} />
      <input
        name="privacy_version"
        type="hidden"
        value={CURRENT_PRIVACY_VERSION}
      />
      <ResultMessage state={state} />

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          メールアドレス
        </label>
        <input
          autoComplete="email"
          className={authInputClassName}
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
          className={authInputClassName}
          id="password"
          maxLength={PASSWORD_MAX_LENGTH}
          minLength={PASSWORD_MIN_LENGTH}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <p className="text-xs text-muted-foreground" id="password-help">
          {PASSWORD_HELP_TEXT}
        </p>
        <PasswordRulesHint password={password} />
        <FieldError errors={state.fieldErrors?.password} />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="password-confirmation">
          パスワード（確認）
        </label>
        <input
          autoComplete="new-password"
          className={authInputClassName}
          id="password-confirmation"
          maxLength={PASSWORD_MAX_LENGTH}
          minLength={PASSWORD_MIN_LENGTH}
          name="password_confirmation"
          onChange={(event) => setPasswordConfirmation(event.target.value)}
          required
          type="password"
          value={passwordConfirmation}
        />
        <PasswordMatchHint
          confirmation={passwordConfirmation}
          password={password}
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

      <TurnstileWidget
        action="signup"
        fieldError={state.fieldErrors?.captcha_token?.[0]}
        resetSignal={state}
      />

      <Button className="h-11 w-full text-sm" disabled={isPending} type="submit" variant="brand">
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

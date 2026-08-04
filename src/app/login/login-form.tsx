"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  resendSignUpConfirmation,
  signIn,
} from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { FieldError, authInputClassName } from "@/components/auth/field-error";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(
    signIn,
    INITIAL_AUTH_FORM_STATE,
  );
  const [resendState, resendAction, resending] = useActionState(
    resendSignUpConfirmation,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <div className="space-y-5">
      {/*
        `data-testid` はUIリデザインの安全網（T-M8-01）。E2Eは入力欄の型やボタンの数へ
        暗黙に依存していた（`input[type=email]` が画面に1つだけ、という前提）。この画面には
        「確認メール再送」の第2フォームがあり、状態次第で送信ボタンが2つになるため、
        見た目を変える前に**印で特定できる**形へ移す。
      */}
      <form action={formAction} className="space-y-5" data-testid="login-form" noValidate>
        <input name="next" type="hidden" value={next} />

        {state.status === "error" ? (
          <Notice role="alert" tone="danger">
            {state.message}
          </Notice>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="login-email">
            メールアドレス
          </label>
          <input
            autoComplete="email"
            className={authInputClassName}
            id="login-email"
            name="email"
            required
            type="email"
          />
          <FieldError errors={state.fieldErrors?.email} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label className="text-sm font-medium" htmlFor="login-password">
              パスワード
            </label>
            <Link
              className="text-sm font-medium underline"
              href="/login?mode=forgot-password"
            >
              パスワードを忘れた方
            </Link>
          </div>
          <input
            autoComplete="current-password"
            className={authInputClassName}
            id="login-password"
            name="password"
            required
            type="password"
          />
          <FieldError errors={state.fieldErrors?.password} />
        </div>

        <TurnstileWidget
          action="login"
          fieldError={state.fieldErrors?.captcha_token?.[0]}
          resetSignal={state}
        />

        <Button className="h-11 w-full text-[14px]" data-testid="login-submit" disabled={pending} type="submit" variant="brand">
          {pending ? "ログインしています…" : "ログイン"}
        </Button>
      </form>

      {state.status === "email_unconfirmed" ? (
        <Notice
          as="section"
          aria-labelledby="email-unconfirmed-heading"
          className="space-y-3"
          tone="warn"
        >
          <h2 className="font-semibold" id="email-unconfirmed-heading">
            メール確認が必要です
          </h2>
          <p className="text-sm">{state.message}</p>
          <form action={resendAction} className="space-y-2">
            <input name="email" type="hidden" value={state.email ?? ""} />
            <TurnstileWidget
              action="signup-resend"
              resetSignal={resendState}
            />
            <Button disabled={resending} type="submit" variant="outline">
              {resending ? "再送しています…" : "確認メールを再送"}
            </Button>
          </form>
          {resendState.status !== "idle" ? (
            <p className="text-sm" role="status">
              {resendState.message}
            </p>
          ) : null}
        </Notice>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">
        アカウントをお持ちでない方は{" "}
        <Link className="font-medium text-foreground underline" href="/signup">
          会員登録
        </Link>
      </p>
    </div>
  );
}

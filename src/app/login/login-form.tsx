"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signIn } from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { FieldError, authInputClassName } from "@/components/auth/field-error";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(
    signIn,
    INITIAL_AUTH_FORM_STATE,
  );

  if (state.status === "email_unconfirmed" && state.email) {
    return (
      <EmailCodeForm
        autoResend
        email={state.email}
        entryNotice={state.message}
      />
    );
  }

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
            {/*
              行き先が返ってきたら一緒に出す（T-M8-127と同じ形）。「登録されていません」だけだと
              同じフォームでパスワードを探し続けることになるので、登録画面への導線を添える。
            */}
            {state.action ? (
              <Link
                className="ml-1 font-medium underline underline-offset-4"
                href={state.action.href}
              >
                {state.action.label}
              </Link>
            ) : null}
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

        <Button className="h-11 w-full text-sm" data-testid="login-submit" disabled={pending} type="submit" variant="brand">
          {pending ? "ログインしています…" : "ログイン"}
        </Button>
      </form>

      {/*
        **アカウントを持っていない人の行き止まりを作らない**（T-M8-268）。LPの友達招待CTAや
        `next` 付きのリンクからここへ着く人は、まだ登録していないことがある。登録後も同じ
        行き先へ戻れるよう `next` を引き継ぐ。**導線はここ1つだけにする**——ページ側にも
        同じリンクがあって二重に出ていた（T-M8-295で解消）。
      */}
      <p className="text-center text-sm text-muted-foreground">
        アカウントをお持ちでない方は{" "}
        <Link
          className="font-medium text-foreground underline"
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
        >
          会員登録
        </Link>
      </p>
    </div>
  );
}

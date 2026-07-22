"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  resendSignUpConfirmation,
  signIn,
} from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { Button } from "@/components/ui/button";

const inputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20";

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
      <form action={formAction} className="space-y-5" noValidate>
        <input name="captcha_token" type="hidden" value="" />
        <input name="next" type="hidden" value={next} />

        {state.status === "error" ? (
          <p
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {state.message}
          </p>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="login-email">
            メールアドレス
          </label>
          <input
            autoComplete="email"
            className={inputClassName}
            id="login-email"
            name="email"
            required
            type="email"
          />
          {state.fieldErrors?.email?.[0] ? (
            <p className="text-sm text-destructive" role="alert">
              {state.fieldErrors.email[0]}
            </p>
          ) : null}
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
            className={inputClassName}
            id="login-password"
            name="password"
            required
            type="password"
          />
          {state.fieldErrors?.password?.[0] ? (
            <p className="text-sm text-destructive" role="alert">
              {state.fieldErrors.password[0]}
            </p>
          ) : null}
        </div>

        <Button className="h-11 w-full" disabled={pending} type="submit">
          {pending ? "ログインしています…" : "ログイン"}
        </Button>
      </form>

      {state.status === "email_unconfirmed" ? (
        <section
          className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950"
          aria-labelledby="email-unconfirmed-heading"
        >
          <h2 className="font-semibold" id="email-unconfirmed-heading">
            メール確認が必要です
          </h2>
          <p className="text-sm">{state.message}</p>
          <form action={resendAction} className="space-y-2">
            <input name="email" type="hidden" value={state.email ?? ""} />
            <input name="captcha_token" type="hidden" value="" />
            <Button disabled={resending} type="submit" variant="outline">
              {resending ? "再送しています…" : "確認メールを再送"}
            </Button>
          </form>
          {resendState.status !== "idle" ? (
            <p className="text-sm" role="status">
              {resendState.message}
            </p>
          ) : null}
        </section>
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

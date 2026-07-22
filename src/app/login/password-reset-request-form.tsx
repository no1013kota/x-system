"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordReset } from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";

const inputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20";

export function PasswordResetRequestForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-5" noValidate>
        {state.status !== "idle" ? (
          <p
            className={
              state.status === "success"
                ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
                : "rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            }
            role={state.status === "success" ? "status" : "alert"}
          >
            {state.message}
          </p>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="reset-email">
            メールアドレス
          </label>
          <input
            autoComplete="email"
            className={inputClassName}
            defaultValue={state.email}
            id="reset-email"
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

        <TurnstileWidget
          action="password-reset"
          fieldError={state.fieldErrors?.captcha_token?.[0]}
          resetSignal={state}
        />

        <Button className="h-11 w-full" disabled={pending} type="submit">
          {pending ? "受け付けています…" : "再設定メールを送る"}
        </Button>
      </form>

      <p className="text-center text-sm">
        <Link className="font-medium underline" href="/login">
          ログインへ戻る
        </Link>
      </p>
    </div>
  );
}

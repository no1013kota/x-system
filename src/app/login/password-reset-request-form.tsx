"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordReset } from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { FieldError, authInputClassName } from "@/components/auth/field-error";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";

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
            className={authInputClassName}
            defaultValue={state.email}
            id="reset-email"
            name="email"
            required
            type="email"
          />
          <FieldError errors={state.fieldErrors?.email} />
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

"use client";

import { useActionState } from "react";

import { resendSignUpConfirmation } from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";

export function ResendConfirmationForm() {
  const [state, formAction, pending] = useActionState(
    resendSignUpConfirmation,
    INITIAL_AUTH_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-3">
      <label className="block space-y-2 text-sm font-medium" htmlFor="email">
        <span>登録したメールアドレス</span>
        <input
          autoComplete="email"
          className="h-11 w-full rounded-lg border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
          id="email"
          name="email"
          required
          type="email"
        />
      </label>
      <TurnstileWidget action="signup-resend" resetSignal={state} />
      <Button disabled={pending} type="submit" variant="outline">
        {pending ? "再送しています…" : "確認メールを再送"}
      </Button>
      {state.status !== "idle" ? (
        <p
          className={
            state.status === "success"
              ? "text-sm text-success-fg"
              : "text-sm text-destructive"
          }
          role={state.status === "success" ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

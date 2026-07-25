"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { updatePassword } from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { PasswordMatchHint, PasswordRulesHint } from "@/components/auth/password-hints";
import { Button } from "@/components/ui/button";
import {
  PASSWORD_HELP_TEXT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/auth/password-policy";

const inputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    INITIAL_AUTH_FORM_STATE,
  );
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-5" noValidate>
        {state.status === "error" ? (
          <p
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {state.message}
          </p>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="new-password">
            新しいパスワード
          </label>
          <input
            autoComplete="new-password"
            className={inputClassName}
            id="new-password"
            maxLength={PASSWORD_MAX_LENGTH}
            minLength={PASSWORD_MIN_LENGTH}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <p className="text-xs text-muted-foreground">
            {PASSWORD_HELP_TEXT}
          </p>
          <PasswordRulesHint password={password} />
          {state.fieldErrors?.password?.[0] ? (
            <p className="text-sm text-destructive" role="alert">
              {state.fieldErrors.password[0]}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor="new-password-confirmation"
          >
            新しいパスワード（確認）
          </label>
          <input
            autoComplete="new-password"
            className={inputClassName}
            id="new-password-confirmation"
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
          {state.fieldErrors?.password_confirmation?.[0] ? (
            <p className="text-sm text-destructive" role="alert">
              {state.fieldErrors.password_confirmation[0]}
            </p>
          ) : null}
        </div>

        <Button className="h-11 w-full" disabled={pending} type="submit">
          {pending ? "更新しています…" : "パスワードを更新"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        リンクが無効な場合は{" "}
        <Link className="font-medium text-foreground underline" href="/login?mode=forgot-password">
          再設定メールを再申請
        </Link>
        してください。
      </p>
    </div>
  );
}

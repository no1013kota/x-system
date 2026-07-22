"use client";

import Link from "next/link";
import { useActionState } from "react";

import { updatePassword } from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { Button } from "@/components/ui/button";

const inputClassName =
  "h-11 w-full rounded-lg border bg-background px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    INITIAL_AUTH_FORM_STATE,
  );

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
            minLength={12}
            name="password"
            required
            type="password"
          />
          <p className="text-xs text-muted-foreground">
            12〜64文字（UTF-8で72バイト以内）
          </p>
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
            minLength={12}
            name="password_confirmation"
            required
            type="password"
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

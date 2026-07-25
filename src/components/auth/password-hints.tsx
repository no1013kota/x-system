"use client";

import type { ReactNode } from "react";

import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPassword,
} from "@/lib/auth/password-policy";

function HintItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li
      className={`flex items-center gap-1.5 ${
        ok ? "text-emerald-600" : "text-muted-foreground"
      }`}
    >
      <span aria-hidden="true">{ok ? "✓" : "○"}</span>
      <span>{children}</span>
      <span className="sr-only">
        {ok ? "（条件を満たしています）" : "（未達成）"}
      </span>
    </li>
  );
}

/**
 * Live password-rule feedback shown while the user types. This is UX only — the
 * server-side zod schema (`authPasswordSchema`) remains the source of truth.
 */
export function PasswordRulesHint({ password }: { password: string }) {
  if (!password) return null;
  const checks = checkPassword(password);
  return (
    <ul className="space-y-1 text-xs" aria-live="polite">
      <HintItem ok={checks.minLength}>{PASSWORD_MIN_LENGTH}文字以上</HintItem>
      {checks.maxLength ? null : (
        <HintItem ok={false}>{PASSWORD_MAX_LENGTH}文字以内</HintItem>
      )}
      {checks.withinBytes ? null : (
        <HintItem ok={false}>UTF-8で{PASSWORD_MAX_BYTES}バイト以内</HintItem>
      )}
    </ul>
  );
}

/** Live confirmation-match feedback shown once the confirmation field has input. */
export function PasswordMatchHint({
  password,
  confirmation,
}: {
  password: string;
  confirmation: string;
}) {
  if (!confirmation) return null;
  return (
    <ul className="space-y-1 text-xs" aria-live="polite">
      <HintItem ok={password === confirmation}>確認用と一致</HintItem>
    </ul>
  );
}

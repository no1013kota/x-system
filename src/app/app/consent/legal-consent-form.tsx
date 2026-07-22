"use client";

import Link from "next/link";
import { useActionState } from "react";

import { acceptLegalUpdates } from "@/app/actions/legal-consent";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { Button } from "@/components/ui/button";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/legal";

export function LegalConsentForm({
  requirePrivacy,
  requireTerms,
}: {
  requirePrivacy: boolean;
  requireTerms: boolean;
}) {
  const [state, action, pending] = useActionState(
    acceptLegalUpdates,
    INITIAL_AUTH_FORM_STATE,
  );
  return (
    <form action={action} className="space-y-5">
      <input name="terms_version" type="hidden" value={CURRENT_TERMS_VERSION} />
      <input
        name="privacy_version"
        type="hidden"
        value={CURRENT_PRIVACY_VERSION}
      />
      {state.status === "error" ? (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      {requireTerms ? (
        <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
          <input className="mt-1 size-4" name="terms_accepted" type="checkbox" />
          <span>
            更新された
            <Link className="mx-1 font-medium underline" href="/terms" target="_blank">
              利用規約
            </Link>
            を確認し、同意します
          </span>
        </label>
      ) : null}
      {state.fieldErrors?.terms_accepted ? (
        <p className="text-sm text-destructive" role="alert">
          {state.fieldErrors.terms_accepted[0]}
        </p>
      ) : null}
      {requirePrivacy ? (
        <label className="flex items-start gap-3 rounded-xl border p-4 text-sm">
          <input
            className="mt-1 size-4"
            name="privacy_acknowledged"
            type="checkbox"
          />
          <span>
            更新された
            <Link className="mx-1 font-medium underline" href="/privacy" target="_blank">
              プライバシーポリシー
            </Link>
            を確認しました
          </span>
        </label>
      ) : null}
      {state.fieldErrors?.privacy_acknowledged ? (
        <p className="text-sm text-destructive" role="alert">
          {state.fieldErrors.privacy_acknowledged[0]}
        </p>
      ) : null}
      <Button className="h-10" disabled={pending} type="submit">
        {pending ? "同意を記録しています…" : "同意して続ける"}
      </Button>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";

import { resendSignUpConfirmation, verifySignUpCode } from "@/app/actions/auth";
import { INITIAL_AUTH_FORM_STATE } from "@/app/actions/auth-state";
import { authInputClassName } from "@/components/auth/field-error";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { EMAIL_CODE_LENGTH, isEmailCodeComplete, normalizeEmailCode } from "@/lib/auth/email-code";

/**
 * メールで届いた6桁コードの入力（T-M8-121）。
 *
 * **リンク方式をやめた理由**は `lib/auth/email-code.ts` に書いてある。ここで大事なのは
 * 「登録した画面から離れずに終われる」こと——だから入力欄をこの場に出し、
 * 送信できないあいだは**なぜ押せないかを画面に出す**（押しても何も起きないボタンを作らない）。
 */
export function EmailCodeForm({ email }: { email: string }) {
  const [state, formAction, isPending] = useActionState(
    verifySignUpCode,
    INITIAL_AUTH_FORM_STATE,
  );
  const [resendState, resendAction, isResending] = useActionState(
    resendSignUpConfirmation,
    INITIAL_AUTH_FORM_STATE,
  );
  const [code, setCode] = useState("");

  const digits = normalizeEmailCode(code);
  const complete = isEmailCodeComplete(code);

  return (
    <section aria-labelledby="code-heading" className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold" id="code-heading">
          確認コードを入力してください
        </h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-ink">{email}</span> に{EMAIL_CODE_LENGTH}
          桁の数字を送信しました。
        </p>
      </div>

      <form action={formAction} className="space-y-3" noValidate>
        <input name="email" type="hidden" value={email} />
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="code">
            確認コード
          </label>
          <input
            aria-describedby="code-help"
            /** 数字キーパッドを出す。`type="number"` はスピナーが付き桁溢れも起きるので使わない。 */
            autoComplete="one-time-code"
            className={`${authInputClassName} text-center text-lg tracking-[0.4em] tabular-nums`}
            id="code"
            inputMode="numeric"
            maxLength={12}
            name="code"
            onChange={(event) => setCode(event.target.value)}
            placeholder="000000"
            required
            value={code}
          />
          <p className="text-caption text-ink-3" id="code-help">
            {complete
              ? "入力できました。「登録を完了する」を押してください。"
              : `メールに記載の${EMAIL_CODE_LENGTH}桁を入力してください（あと${Math.max(
                  0,
                  EMAIL_CODE_LENGTH - digits.length,
                )}桁）。`}
          </p>
        </div>

        {state.status === "error" ? (
          <Notice role="alert" tone="danger">
            {state.message}
          </Notice>
        ) : null}

        <Button disabled={isPending || !complete} type="submit">
          {isPending ? "確認しています…" : "登録を完了する"}
        </Button>
      </form>

      <form action={resendAction} className="space-y-3 border-t border-hairline pt-4">
        <input name="email" type="hidden" value={email} />
        <p className="text-sm text-muted-foreground">
          コードが届かない場合は、迷惑メールフォルダをご確認のうえ再送してください。
        </p>
        {/*
          **コードを打つ画面にCloudflareのUIを出さない**（T-M8-138・運営者の指示）。
          コード検証自体は人間確認を求めていないので、同じ画面にウィジェットが見えていると
          「コードを打つのに確認が要る」と読めてしまう。
          ただし Supabase の `resend` はcaptcha有効時にトークン無しを拒否するため、
          確認そのものはinteraction-onlyで残す（外すと再送が壊れる）。
        */}
        <TurnstileWidget
          action="signup-resend"
          interactionOnly
          resetSignal={resendState}
        />
        <Button disabled={isResending} type="submit" variant="outline">
          {isResending ? "再送しています…" : "コードを再送"}
        </Button>
        {resendState.status !== "idle" ? (
          <Notice
            role={resendState.status === "error" ? "alert" : "status"}
            tone={resendState.status === "success" ? "success" : "danger"}
          >
            {resendState.message}
          </Notice>
        ) : null}
      </form>
    </section>
  );
}

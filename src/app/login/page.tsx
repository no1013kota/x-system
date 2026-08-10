import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { safeAuthNext } from "@/lib/auth/confirm";
import { env } from "@/lib/env";
import { LegalFooter } from "@/components/legal-footer";

import { PasswordResetRequestForm } from "./password-reset-request-form";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: `ログイン | ${APP_NAME}`,
};

interface LoginPageProps {
  searchParams: Promise<{
    mode?: string;
    next?: string;
    password_updated?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const requestedNext = params.next ?? null;
  const next =
    safeAuthNext(requestedNext, env.APP_BASE_URL as string) ?? "";
  const requestingReset = params.mode === "forgot-password";

  return (
    // 法務3ページへの導線を置く（T-M8-30）。会員登録には前からあり、**ログインだけ無かった**。
    // ログインから入る利用者が規約へ辿れない状態を残さない（要件06 §11）。
    <div className="bg-page flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] space-y-6 rounded-card border border-hairline bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-7">
        <header className="space-y-2 text-center">
          <span className="inline-flex items-center justify-center gap-2">
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-card text-[15px] font-bold text-white"
              style={{ backgroundImage: "var(--brand-gradient-logo)" }}
            >
              S
            </span>
            <Link className="text-[16px] font-bold tracking-tight text-ink" href="/">
              {APP_NAME}
            </Link>
          </span>
          <h1 className="text-[22px] font-bold tracking-tight text-ink">
            {requestingReset ? "パスワード再設定" : "ログイン"}
          </h1>
          <p className="text-body leading-5 text-ink-2">
            {requestingReset
              ? "登録したメールアドレスへ再設定リンクを送ります。"
              : "メールアドレスとパスワードを入力してください。"}
          </p>
        </header>
        {params.password_updated === "1" && !requestingReset ? (
          <p
            className="rounded-lg bg-success-bg p-3 text-sm text-success-fg"
            role="status"
          >
            パスワードを更新しました。新しいパスワードでログインしてください。
          </p>
        ) : null}
        {requestingReset ? (
          <PasswordResetRequestForm />
        ) : (
          <LoginForm next={next} />
        )}
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}

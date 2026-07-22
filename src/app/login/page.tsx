import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { safeAuthNext } from "@/lib/auth/confirm";
import { env } from "@/lib/env";

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
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md space-y-7 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <header className="space-y-2 text-center">
          <Link className="text-sm font-semibold tracking-wide" href="/">
            {APP_NAME}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            {requestingReset ? "パスワード再設定" : "ログイン"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {requestingReset
              ? "登録したメールアドレスへ再設定リンクを送ります。"
              : "メールアドレスとパスワードを入力してください。"}
          </p>
        </header>
        {params.password_updated === "1" && !requestingReset ? (
          <p
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
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
  );
}

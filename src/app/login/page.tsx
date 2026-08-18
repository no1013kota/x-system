import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth/auth-page-shell";

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
    <AuthPageShell
      description={
        requestingReset
          ? "登録したメールアドレスへ再設定リンクを送ります。"
          : "メールアドレスとパスワードを入力してください。"
      }
      title={requestingReset ? "パスワード再設定" : "ログイン"}
    >
      {params.password_updated === "1" && !requestingReset ? (
        <p className="rounded-lg bg-success-bg p-3 text-sm text-success-fg" role="status">
          パスワードを更新しました。新しいパスワードでログインしてください。
        </p>
      ) : null}
      {requestingReset ? <PasswordResetRequestForm /> : <LoginForm next={next} />}
    </AuthPageShell>
  );
}

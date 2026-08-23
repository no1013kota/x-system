import type { Metadata } from "next";
import Link from "next/link";

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
      {/*
        **アカウントを持っていない人の行き止まりを作らない**（T-M8-268）。LPの友達招待CTAや
        `next` 付きのリンクからここへ着く人は、まだ登録していないことがある。登録後も同じ
        行き先へ戻れるよう `next` を引き継ぐ。
      */}
      {!requestingReset ? (
        <p className="text-center text-body text-ink-2">
          アカウントをお持ちでない方は
          <Link
            className="mx-1 font-medium text-info-fg hover:underline"
            href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          >
            新規登録
          </Link>
          へ
        </p>
      ) : null}
    </AuthPageShell>
  );
}

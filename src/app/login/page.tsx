import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";
import { safeAuthNext } from "@/lib/auth/confirm";
import { env } from "@/lib/env";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: `ログイン | ${APP_NAME}`,
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const requestedNext = (await searchParams).next ?? null;
  const next =
    safeAuthNext(requestedNext, env.APP_BASE_URL as string) ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md space-y-7 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <header className="space-y-2 text-center">
          <Link className="text-sm font-semibold tracking-wide" href="/">
            {APP_NAME}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">ログイン</h1>
          <p className="text-sm text-muted-foreground">
            メールアドレスとパスワードを入力してください。
          </p>
        </header>
        <LoginForm next={next} />
      </div>
    </main>
  );
}

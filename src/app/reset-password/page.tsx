import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: `パスワード再設定 | ${APP_NAME}`,
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md space-y-7 rounded-card border bg-card p-6 shadow-sm sm:p-8">
        <header className="space-y-2 text-center">
          <Link className="text-sm font-semibold tracking-wide" href="/">
            {APP_NAME}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            新しいパスワードを設定
          </h1>
          <p className="text-sm text-muted-foreground">
            今後のログインに使用するパスワードを入力してください。
          </p>
        </header>
        <ResetPasswordForm />
      </div>
    </main>
  );
}

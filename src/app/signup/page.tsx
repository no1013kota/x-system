import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";

import { SignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: `会員登録 | ${APP_NAME}`,
};

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-md space-y-7 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <header className="space-y-2 text-center">
          <Link className="text-sm font-semibold tracking-wide" href="/">
            {APP_NAME}
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">会員登録</h1>
          <p className="text-sm text-muted-foreground">
            登録後、確認メールからメールアドレスを認証してください。
          </p>
        </header>
        <SignUpForm />
      </div>
    </main>
  );
}

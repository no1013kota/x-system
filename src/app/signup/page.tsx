import type { Metadata } from "next";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";

import { SignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: `会員登録 | ${APP_NAME}`,
};

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <main className="bg-page flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6 rounded-card border border-hairline bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-7">
          <header className="space-y-2 text-center">
            <Link className="text-sm font-semibold tracking-wide" href="/">
              {APP_NAME}
            </Link>
            <h1 className="text-[22px] font-bold tracking-tight text-ink">会員登録</h1>
            <p className="text-[12.5px] leading-5 text-ink-2">
              登録後、確認メールからメールアドレスを認証してください。
            </p>
          </header>
          <SignUpForm />
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}

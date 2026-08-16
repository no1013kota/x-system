import type { Metadata } from "next";
import { LogoTile } from "@/components/app-shell/brand-logo";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";

import { SignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: `会員登録 | ${APP_NAME}`,
};

export default function SignUpPage() {
  return (
    <div className="bg-page flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6 rounded-card border border-hairline bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-7">
          <header className="space-y-2 text-center">
            {/* ヘッダはlogin/page.tsxと同じ構成（ロゴマーク＋アプリ名・T-M8-60）。 */}
            <span className="inline-flex items-center justify-center gap-2">
              <LogoTile size={28} />
              <Link className="text-[16px] font-bold tracking-tight text-ink" href="/">
                {APP_NAME}
              </Link>
            </span>
            <h1 className="text-[22px] font-bold tracking-tight text-ink">会員登録</h1>
            <p className="text-body leading-5 text-ink-2">
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

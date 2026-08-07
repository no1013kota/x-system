import type { Metadata } from "next";
import Link from "next/link";

import { LegalFooter } from "@/components/legal-footer";
import { APP_NAME } from "@/lib/app-config";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: `パスワード再設定 | ${APP_NAME}`,
};

// 構成・カードの見た目は login/page.tsx と揃える（T-M8-60。
// login→signup→reset と遷移したとき、この画面だけ旧デザインでトーンが変わっていた）。
export default function ResetPasswordPage() {
  return (
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
              新しいパスワードを設定
            </h1>
            <p className="text-body leading-5 text-ink-2">
              今後のログインに使用するパスワードを入力してください。
            </p>
          </header>
          <ResetPasswordForm />
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}

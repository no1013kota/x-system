import type { Metadata } from "next";
import Link from "next/link";

import { APP_NAME } from "@/lib/app-config";

import { ResendConfirmationForm } from "./resend-confirmation-form";

export const metadata: Metadata = {
  title: `認証リンクエラー | ${APP_NAME}`,
};

interface AuthErrorPageProps {
  searchParams: Promise<{ flow?: string }>;
}

export default async function AuthErrorPage({
  searchParams,
}: AuthErrorPageProps) {
  const recovery = (await searchParams).flow === "recovery";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <section className="w-full max-w-md space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="space-y-2">
          <p className="text-sm font-semibold">{APP_NAME}</p>
          <h1 className="text-2xl font-bold">リンクを確認できませんでした</h1>
          <p className="text-sm text-muted-foreground" role="alert">
            リンクの有効期限が切れているか、すでに使用されています。新しいリンクをお試しください。
          </p>
        </div>

        {recovery ? (
          <div className="space-y-3">
            <p className="text-sm">パスワード再設定メールをもう一度申請してください。</p>
            <Link
              className="inline-flex font-medium underline"
              href="/login?mode=forgot-password"
            >
              パスワード再設定を申請
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">確認メールを再送できます。</p>
            <ResendConfirmationForm />
          </div>
        )}
      </section>
    </main>
  );
}

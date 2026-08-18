import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth/auth-page-shell";

import { APP_NAME } from "@/lib/app-config";

import { SignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: `会員登録 | ${APP_NAME}`,
};

export default function SignUpPage() {
  return (
    <AuthPageShell
      // 6桁コード方式（T-M8-121）。**リンクを追わせない**——以前の文言は
      // 「確認メールからメールアドレスを認証してください」でリンク追跡を促していた（T-M8-144）。
      description="登録後、メールで届く6桁の確認コードを入力してください。"
      title="会員登録"
    >
      <SignUpForm />
    </AuthPageShell>
  );
}

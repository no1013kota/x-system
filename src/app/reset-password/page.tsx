import type { Metadata } from "next";

import { AuthPageShell } from "@/components/auth/auth-page-shell";

import { APP_NAME } from "@/lib/app-config";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: `パスワード再設定 | ${APP_NAME}`,
};

// 構成・カードの見た目は login/page.tsx と揃える（T-M8-60。
// login→signup→reset と遷移したとき、この画面だけ旧デザインでトーンが変わっていた）。
export default function ResetPasswordPage() {
  return (
    <AuthPageShell
      description="今後のログインに使用するパスワードを入力してください。"
      title="新しいパスワードを設定"
    >
      <ResetPasswordForm />
    </AuthPageShell>
  );
}

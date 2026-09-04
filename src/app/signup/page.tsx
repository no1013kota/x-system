import type { Metadata } from "next";
import { recordPageView } from "@/lib/ops/page-view-server";
import { parseTrafficSource } from "@/lib/ops/traffic-source";

import { AuthPageShell } from "@/components/auth/auth-page-shell";

import { APP_NAME } from "@/lib/app-config";

import { SignUpForm } from "./signup-form";

export const metadata: Metadata = {
  title: `会員登録 | ${APP_NAME}`,
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string | string[] }>;
}) {
  // 流入元（T-M8-423）。LPから引き継いだ `?src=` を閲覧記録と登録（hidden）へ渡す。
  const source = parseTrafficSource((await searchParams).src);
  // 入口ファネル（T-M8-378）。応答後に書くので表示は遅くならない。
  await recordPageView("/signup", { source });

  return (
    <AuthPageShell
      // 6桁コード方式（T-M8-121）。**リンクを追わせない**——以前の文言は
      // 「確認メールからメールアドレスを認証してください」でリンク追跡を促していた（T-M8-144）。
      description="登録後、メールで届く6桁の確認コードを入力してください。"
      title="会員登録"
    >
      <SignUpForm signupSource={source} />
    </AuthPageShell>
  );
}

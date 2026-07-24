import type { Metadata } from "next";
import Link from "next/link";

import { CURRENT_PRIVACY_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Space AI",
};

// nonceベースCSP（T-M6-17）のため動的レンダリング（静的prerenderはnonce付与不可）。
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-5 py-12">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          暫定版 {CURRENT_PRIVACY_VERSION}
        </p>
        <h1 className="text-3xl font-bold">プライバシーポリシー</h1>
        <p className="text-sm text-destructive">
          本文は開発用の暫定版です。公開前に法務確認を行います。
        </p>
      </header>
      <section className="space-y-4 leading-7">
        <h2 className="text-xl font-semibold">取得する情報と利用目的</h2>
        <p>
          アカウント情報、設定、生成・投稿履歴を、本人確認、サービス提供、品質改善、問い合わせ対応のために取り扱います。
        </p>
        <h2 className="text-xl font-semibold">外部サービスへの送信</h2>
        <p>
          機能提供に必要な範囲で、生成AI事業者、X、決済・認証基盤へ情報を送信します。国外で取り扱われる場合があります。
        </p>
        <h2 className="text-xl font-semibold">保持・安全管理</h2>
        <p>
          利用目的に必要な期間だけ情報を保持し、アクセス制御や暗号化などの安全管理措置を講じます。
        </p>
        <h2 className="text-xl font-semibold">開示等の請求</h2>
        <p>
          保有個人データの開示、訂正、削除等のご相談は、サービス内の問い合わせ先から受け付けます。
        </p>
      </section>
      <Link className="font-medium underline" href="/signup">
        会員登録へ戻る
      </Link>
    </main>
  );
}

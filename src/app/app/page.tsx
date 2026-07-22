import type { Metadata } from "next";

import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  title: `ホーム | ${APP_NAME}`,
};

export default function AppHomePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-bold">ホーム</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          投稿運用ホームはM3以降の機能実装に合わせて拡張します。
        </p>
      </div>
    </main>
  );
}

"use client";

import { ErrorState } from "@/components/app-shell/page-state";

export default function AppError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">
      <ErrorState
        description="時間をおいて再度お試しください。問題が続く場合はアカウント設定からお問い合わせください。"
        retry={reset}
        title="画面を読み込めませんでした"
      />
    </main>
  );
}

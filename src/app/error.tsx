"use client";

import { ErrorState } from "@/components/app-shell/page-state";

/**
 * ルートセグメントの error boundary（T-M8-158）。
 *
 * **`src/app/app/error.tsx` は同じセグメントの `app/app/layout.tsx` の例外を受けない。**
 * App Shellのデータ取得（通知・Xアカウント・profile・利用量・キーstatus）はいずれも失敗で
 * throw するため、これが無いと `/app` 配下の全画面が**Next.js既定のエラーページ**になり、
 * 何が起きたかも再試行の導線も出ない（原則2「原因が開発知識なしで辿れる」）。
 *
 * layoutが失敗している状態ではヘッダ・サイドバーを描けない前提なので、単独で成立する画面にする。
 * 器と文言は `app/app/error.tsx` と同じものを使う（同じ失敗が場所で違う見え方にならないように）。
 */
export default function RootError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">
      <ErrorState
        description="時間をおいて再度お試しください。"
        retry={reset}
        title="画面を読み込めませんでした"
      />
    </main>
  );
}

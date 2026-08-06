import { LoadingState } from "@/components/app-shell/page-state";

/**
 * /plans の遷移中表示（T-M8-67）。このページはサーバーで認証確認と契約状態の取得を行うため、
 * loading.tsx が無いとランディングやログイン直後からの遷移で応答が返るまで画面が無反応になる。
 */
export default function PlansLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 lg:px-8">
      <LoadingState />
    </main>
  );
}

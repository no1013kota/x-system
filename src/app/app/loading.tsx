import { LoadingState } from "@/components/app-shell/page-state";

export default function AppLoading() {
  return (
    // コンテナは各ページの main と同じ（幅と縦位置が本表示への切り替わりで跳ねないように・T-M8-67）。
    <main className="mx-auto w-full max-w-[1180px] px-4 py-[26px] lg:px-8">
      <LoadingState />
    </main>
  );
}

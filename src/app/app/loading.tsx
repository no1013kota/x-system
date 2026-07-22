import { LoadingState } from "@/components/app-shell/page-state";

export default function AppLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 lg:px-8">
      <LoadingState />
    </main>
  );
}

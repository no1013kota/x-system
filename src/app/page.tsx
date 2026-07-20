import { Button } from "@/components/ui/button";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">{APP_NAME}</h1>
      <p className="max-w-md text-center text-muted-foreground">
        {APP_DESCRIPTION}
      </p>
      <Button>開発中 — M0: リポジトリ・実行基盤</Button>
    </main>
  );
}

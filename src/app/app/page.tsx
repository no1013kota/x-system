import type { Metadata } from "next";

import { SetupGuideCard } from "@/components/app-shell/setup-guide-card";
import { APP_NAME } from "@/lib/app-config";
import { getCurrentUser } from "@/lib/auth/session";
import {
  buildSetupChecklist,
  type SetupChecklistItem,
} from "@/lib/execution-prereqs";
import { gatherExecutionPrereqInputs } from "@/lib/execution-prereqs-server";

export const metadata: Metadata = {
  title: `ホーム | ${APP_NAME}`,
};

export default async function AppHomePage() {
  const user = await getCurrentUser();
  let checklist: SetupChecklistItem[] = [];
  if (user) {
    // 充足判定は実行前提検証ヘルパを再利用する（要件06 §3.1・T-M2-24）。
    const input = await gatherExecutionPrereqInputs(user.id);
    if (input) checklist = buildSetupChecklist(input);
  }
  const showGuide = checklist.some((item) => !item.satisfied);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 lg:px-8 lg:py-10">
      {showGuide ? <SetupGuideCard items={checklist} /> : null}

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-bold">ホーム</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          投稿運用ホームはM3以降の機能実装に合わせて拡張します。
        </p>
      </div>
    </main>
  );
}

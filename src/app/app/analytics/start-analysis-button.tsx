"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { startAnalysisAction } from "@/app/actions/analysis";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * 「分析を開始」ボタン(K-2/K-3, T-M8-255)。投稿分析の起点はこのボタンだけ
 * （毎朝の自動実行は廃止）。フォロワー数の当日分も押した時点の最新値で上書きするが、
 * 毎日の記録自体は毎時cron（follower_snapshot・T-M8-257）が担う。
 *
 * - 実行中(queued/running のsuggestion jobがある)は押せない——押しても
 *   already_running が返るだけなので、押せない理由をラベルで先に見せる(原則2)
 * - 結果は成功・失敗ともトーストで返し、router.refresh() で「分析中…」バッジへ引き継ぐ
 */
export function StartAnalysisButton({ generating }: { generating: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const res = await startAnalysisAction();
      toast.show({
        description: res.message,
        title: res.status === "success" ? "分析" : "分析を開始できませんでした",
        tone: res.status === "success" ? "success" : "error",
      });
      router.refresh();
    });
  }

  return (
    <Button disabled={pending || generating} onClick={start} type="button">
      {pending ? "開始しています…" : generating ? "分析中…" : "分析を開始"}
    </Button>
  );
}

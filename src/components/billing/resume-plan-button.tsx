"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { startPlanResume } from "@/lib/stripe/resume-browser";
import { usePageshowReset } from "@/lib/ui/use-pageshow-reset";

/**
 * 解約済み契約の再開ボタン（T-M8-264）。
 *
 * canceled の利用者に `PortalButton` を出すと「プランを変更」がPortalトップで行き止まりになる
 * （flow対象は active/trialing/past_due のみ）。ここは Stripe への画面遷移なしで
 * `POST /api/stripe/resume` を呼び、**保存済みカードでその場で再開**する。
 * 成功・失敗はトーストで返し（原則1）、成功時は refresh で契約状態の表示を更新する。
 */
export function ResumePlanButton({ planLabel }: { planLabel: string }) {
  const [pending, setPending] = useState(false);
  usePageshowReset(() => setPending(false));
  const router = useRouter();
  const toast = useToast();

  async function resume() {
    setPending(true);
    try {
      const body = await startPlanResume();
      if (!body.ok) {
        toast.show({
          tone: "error",
          title: "プランを再開できませんでした",
          description:
            (body && "error" in body && body.error?.message) ||
            "時間をおいてもう一度お試しください。",
        });
        return;
      }
      // synced=false は「契約は成立したがDB反映が遅れる」——refresh後も「解約済み」表示が
      // 残り得るので、成功文と画面の食い違いを先に説明する（レビューで検出・原則1）。
      toast.show({
        tone: "success",
        title: "プランを再開しました",
        description: body.data.synced
          ? `${planLabel}のご契約が本日から有効になりました。`
          : `${planLabel}のご契約が本日から有効になりました。この画面への反映には数十秒かかることがあります。`,
      });
      router.refresh();
    } catch {
      toast.show({
        tone: "error",
        title: "プランを再開できませんでした",
        description: "通信に失敗しました。時間をおいてもう一度お試しください。",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          aria-busy={pending}
          className="h-9"
          disabled={pending}
          onClick={resume}
          size="lg"
          type="button"
          variant="brand"
        >
          {pending ? "再開しています…" : "プランを再開"}
        </Button>
        {/* 別プランで再開したい・カードを替えたい場合の逃げ道（Checkout＝カード入力つき）。 */}
        <Link className="text-body text-info-fg hover:underline" href="/plans">
          別のプランを選ぶ
        </Link>
      </div>
      {/* 押す前に「いつから・いくら・無料か」が分かるようにする（T-M8-55と同じ原則）。 */}
      <p className="text-caption text-ink-3">
        登録済みのお支払い方法で{planLabel}を本日から再開し、月額料金の請求が始まります（無料期間はありません）。
      </p>
    </div>
  );
}

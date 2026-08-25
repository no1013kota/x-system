"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cancelScheduledPlanChangeAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * 予約済みの下位プラン変更の取り消し（T-M8-260）。
 *
 * Stripe Portal には「今のプランのまま続ける（予約だけ取り消す）」が無いため、ここで完結させる。
 * 取り消しは Stripe の schedule を解除するだけで、請求は発生しない。
 */
export function CancelScheduledPlanChangeButton({ description }: { description: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function cancel() {
    if (!window.confirm(`${description}\n\nこの予約を取り消して、現在のプランのまま続けます。よろしいですか？`)) {
      return;
    }
    startTransition(async () => {
      const result = await cancelScheduledPlanChangeAction();
      if (result.status === "error") {
        toast.show({ tone: "error", title: "予約を取り消せませんでした", description: result.message });
        return;
      }
      toast.show({ tone: "success", title: result.message });
      router.refresh();
    });
  }

  return (
    <Button
      aria-busy={pending}
      className="h-9"
      disabled={pending}
      onClick={cancel}
      size="lg"
      type="button"
      variant="brand"
    >
      {pending ? "取り消しています…" : "プラン変更の予約を取り消す"}
    </Button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { keepSubscriptionAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * 解約予定の取り消し（T-M8-271・運営者の指示 2026-08-23「押した後はすぐに取り消す」）。
 *
 * 以前は Stripe の Portal トップを開いて、その中の「プランを続ける」を押させていた。
 * 押した人には**同じ操作をもう1画面挟むだけ**に見えるので、この場で終わらせる。
 */
export function KeepSubscriptionButton({ endsAtLabel }: { endsAtLabel: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function keep() {
    if (!window.confirm(`${endsAtLabel}の解約予定を取り消して、今までどおりご利用を続けます。よろしいですか？`)) {
      return;
    }
    startTransition(async () => {
      const result = await keepSubscriptionAction();
      if (result.status === "error") {
        toast.show({ tone: "error", title: "解約予定を取り消せませんでした", description: result.message });
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
      onClick={keep}
      size="lg"
      type="button"
      variant="brand"
    >
      {pending ? "取り消しています…" : "解約予定を取り消す"}
    </Button>
  );
}

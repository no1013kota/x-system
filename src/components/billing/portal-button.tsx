"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { startCustomerPortal } from "@/lib/stripe/portal-browser";

export function PortalButton({ enabled }: { enabled: boolean }) {
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function openPortal() {
    setPending(true);
    try {
      await startCustomerPortal();
    } catch (cause) {
      toast.show({
        tone: "error",
        title: "お支払い管理画面を開けませんでした",
        description: cause instanceof Error ? cause.message : "時間をおいてもう一度お試しください。",
      });
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        aria-busy={pending}
        className="h-9"
        disabled={!enabled || pending}
        onClick={openPortal}
        size="lg"
        type="button"
        variant="brand"
      >
        {pending ? "お支払い管理画面を開いています…" : "お支払い方法・プランを管理"}
      </Button>
      {!enabled ? (
        <p className="text-sm text-muted-foreground">
          お申し込み後にお支払い管理をご利用いただけます。
        </p>
      ) : null}
    </div>
  );
}

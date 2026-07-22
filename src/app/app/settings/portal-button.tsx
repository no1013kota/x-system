"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { startCustomerPortal } from "@/lib/stripe/portal-browser";

export function PortalButton({ enabled }: { enabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setPending(true);
    setError(null);
    try {
      await startCustomerPortal();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "お支払い管理画面を開けませんでした。",
      );
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        aria-busy={pending}
        disabled={!enabled || pending}
        onClick={openPortal}
        type="button"
      >
        {pending ? "お支払い管理画面を開いています…" : "お支払い方法・プランを管理"}
      </Button>
      {!enabled ? (
        <p className="text-sm text-muted-foreground">
          お申し込み後にお支払い管理をご利用いただけます。
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

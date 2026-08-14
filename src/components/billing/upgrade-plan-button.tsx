"use client";

import Link from "next/link";
import { useState } from "react";

import { stateActionClassName } from "@/components/app-shell/page-state";
import { useToast } from "@/components/ui/toast";
import { startCustomerPortal } from "@/lib/stripe/portal-browser";

/**
 * 上位プランへの変更へ直接入る導線（T-M8-89）。
 *
 * **以前は `/plans` へのリンクだった。これは行き止まりだった**——`/plans` は契約が有効で
 * Stripeの顧客が紐づいた利用者を `/app` へ送り返すため（T-M8-54の判定）、standardプランの
 * 契約者が「アップグレード」を押すとホームへ戻るだけで何も起きなかった。
 *
 * E2E（`ai-settings.spec.ts`）はこの導線を検証していたが、**fixtureが
 * `stripe_customer_id` をNULLのままにしていた**ため `/plans` の送り返しが発生せず、
 * 実利用者だけが踏む状態を再現できていなかった。
 *
 * 契約者の行き先は Stripe Customer Portal のプラン選択画面（`intent="update"`）。
 * `PortalButton`（設定＞課金）の「プランを変更」と同じ経路を使う。
 *
 * Stripeの顧客がまだ無い契約者（webhookの到着待ち等）だけは `/plans` へ送る。この状態では
 * Portalセッションを作れず、`/plans` 側も送り返さない（T-M8-54で例外にしてある）。
 */
export function UpgradePlanButton({
  /** Stripeの顧客が紐づいているか。無いあいだは Portal を作れない。 */
  enabled,
}: {
  enabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const toast = useToast();

  if (!enabled) {
    return (
      <Link className={stateActionClassName} href="/plans">
        プランをアップグレード
      </Link>
    );
  }

  return (
    <button
      aria-busy={pending}
      // 押している間は見た目でも進行中だと分かるようにする（文言だけだと見落とす）。
      className={`${stateActionClassName} disabled:cursor-not-allowed disabled:opacity-70`}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await startCustomerPortal("update");
        } catch (cause) {
          // 黙って何も起きないボタンにしない（CLAUDE.md 原則1）。
          toast.show({
            tone: "error",
            title: "プラン変更画面を開けませんでした",
            description:
              cause instanceof Error ? cause.message : "時間をおいてもう一度お試しください。",
          });
          setPending(false);
        }
      }}
      type="button"
    >
      {pending ? "開いています…" : "プランをアップグレード"}
    </button>
  );
}

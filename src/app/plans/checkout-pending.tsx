"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { primaryLinkClassName } from "@/components/ui/link-button";
import { Notice } from "@/components/ui/notice";

/**
 * Checkout完了後、契約情報の反映を待つ間の表示（要件06 §1.1）。反映が終わると
 * `/plans` のサーバ側判定が `/app` へリダイレクトするため、ここでは一定間隔で
 * `router.refresh()` して待つ。プラン比較表とCTAは呼び出し側で描画しないので、
 * この画面から二重に申し込めない。
 */

const RETRY_INTERVAL_MS = 5000;
/** 自動再確認の上限（約1分）。これを過ぎたら手動確認と問い合わせへ切り替える。 */
const MAX_AUTO_RETRIES = 12;

export function CheckoutPending({ supportEmail }: { supportEmail: string | null }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const [pending, startTransition] = useTransition();
  const exhausted = attempts >= MAX_AUTO_RETRIES;

  useEffect(() => {
    if (exhausted) return;
    const timer = setTimeout(() => {
      setAttempts((current) => current + 1);
      startTransition(() => router.refresh());
    }, RETRY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [attempts, exhausted, router]);

  return (
    <Notice
      as="section"
      aria-live="polite"
      className="mx-auto max-w-3xl px-6 py-5"
      role="status"
      tone="success"
    >
      <h2 className="text-lg font-semibold">お申し込みを受け付けました</h2>
      <p className="mt-2 text-sm leading-6">
        契約情報の反映を確認しています（通常1分ほどで完了します）。このままお待ちいただくと、反映後に自動でホームへ移動します。
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className={`${primaryLinkClassName} min-h-11 disabled:opacity-60`}
          disabled={pending}
          onClick={() => {
            setAttempts(0);
            startTransition(() => router.refresh());
          }}
          type="button"
        >
          {pending ? "確認しています…" : "状況を再確認"}
        </button>
        <span className="text-xs text-success-fg">
          {exhausted
            ? "自動確認を停止しました。"
            : "数秒ごとに自動で確認しています。"}
        </span>
      </div>
      {/* この画面では申込ボタン自体が出ないため、二重申込の警告は問い合わせ文へ畳む（T-M8-66）。 */}
      <p className="mt-4 text-xs leading-5 text-success-fg">
        5分以上反映されない場合は、再度お申し込みせず
        {supportEmail ? (
          <>
            <a className="mx-1 font-medium underline underline-offset-4" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
            までお問い合わせください。
          </>
        ) : (
          "お問い合わせください。"
        )}
      </p>
    </Notice>
  );
}

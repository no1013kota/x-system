"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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
    <section
      aria-live="polite"
      className="mx-auto max-w-3xl rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950"
      role="status"
    >
      <h2 className="text-lg font-semibold">お申し込みを受け付けました</h2>
      <p className="mt-2 text-sm leading-6">
        契約情報の反映を確認しています（通常1分ほどで完了します）。このままお待ちいただくと、反映後に自動でホームへ移動します。
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex min-h-11 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-60"
          disabled={pending}
          onClick={() => {
            setAttempts(0);
            startTransition(() => router.refresh());
          }}
          type="button"
        >
          {pending ? "確認しています…" : "状況を再確認"}
        </button>
        <span className="text-xs text-emerald-900">
          {exhausted
            ? "自動確認を停止しました。"
            : "数秒ごとに自動で確認しています。"}
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-emerald-900">
        カードのお支払いは完了しています。反映待ちの間に
        <strong className="mx-1">重ねてお申し込みしないでください</strong>
        （二重に請求される場合があります）。5分以上変わらない場合は
        {supportEmail ? (
          <>
            、
            <a className="mx-1 font-medium underline underline-offset-4" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
            までお問い合わせください。
          </>
        ) : (
          "、お問い合わせください。"
        )}
      </p>
    </section>
  );
}

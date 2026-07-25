import Link from "next/link";

/**
 * Xアカウント未連携時の共通アラート（要件06 §1/§9）。active な X アカウントが無いと投稿生成・
 * スケジュール等が使えないため、設定の連携画面へ誘導する。アクション別の理由文だけ `description`
 * で差し替え、見た目（amberアラート＋「設定へ」導線）は全画面で統一する。
 */
export function XAccountRequiredNotice({ description }: { description: string }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950" role="alert">
      <p className="font-semibold">Xアカウントの連携が必要です</p>
      <p className="mt-1 text-sm">{description}</p>
      <Link
        className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background"
        href="/app/settings?tab=x-accounts"
      >
        設定へ
      </Link>
    </div>
  );
}

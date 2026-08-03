import Link from "next/link";
import { primaryLinkClassName } from "@/components/ui/link-button";

/**
 * Xアカウント未連携時の共通アラート（要件06 §1/§9）。active な X アカウントが無いと投稿生成・
 * スケジュール等が使えないため、設定の連携画面へ誘導する。アクション別の理由文だけ `description`
 * で差し替え、見た目（amberアラート＋「設定へ」導線）は全画面で統一する。
 */
export function XAccountRequiredNotice({ description }: { description: string }) {
  return (
    <div className="rounded-card border border-warn-fg/25 bg-warn-bg p-5 text-warn-fg" role="alert">
      <p className="font-semibold">Xアカウントの連携が必要です</p>
      <p className="mt-1 text-sm">{description}</p>
      <Link
        className={`mt-4 ${primaryLinkClassName}`}
        href="/app/settings?tab=x-accounts"
      >
        設定へ
      </Link>
    </div>
  );
}

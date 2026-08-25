import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { CardTitle, cardClassName } from "@/components/ui/card";
import { secondaryLinkClassName } from "@/components/ui/link-button";

/**
 * 下書きタブに出すスケジュールへの誘導（T-M8-10→T-M8-227）。
 *
 * 以前は枠の中身（時刻・曜日・パターン）まで一覧していたが、**中身の閲覧・編集は
 * スケジュール画面が正本**で、ここに写すと2画面の表示が食い違う余地が残る。
 * 誘導の文章とボタンだけにする（運営者の指示 2026-08-22）。
 */
export function ScheduleSummary() {
  return (
    <section aria-label="スケジュール" className={`${cardClassName} px-5 py-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>スケジュール</CardTitle>
          <p className="mt-1 text-body leading-5 text-ink-2">
            曜日と時刻を決めておくと、下書きの作成や投稿を自動で行えます。設定と今後の予定はスケジュールページで確認できます。
          </p>
        </div>
        <Link className={secondaryLinkClassName} href="/app/schedule">
          <Icon name="tune" size={16} />
          スケジュールを開く
        </Link>
      </div>
    </section>
  );
}

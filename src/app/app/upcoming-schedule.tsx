import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { primaryLinkClassName } from "@/components/ui/link-button";
import type { ScheduleOutlook } from "@/lib/home/overview";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";
import { Notice } from "@/components/ui/notice";

/**
 * SC-05 ホームの「次回の予定」（要件06 §1・§10, T-M7-03）。有効スロットの次回実行を早い順に示し、
 * 未登録・全停止それぞれで SC-08 への導線を出す。初期設定が未完了なら、予定があっても実行されない
 * ことを警告して次の設定へ送る（行き止まりを作らない）。表示専用のため server component。
 */

const MODE_LABEL: Record<string, string> = {
  auto: "自動で投稿",
  draft: "下書きを作成",
};

/**
 * 器とリンクは共通部品を使う（T-M8-41）。
 *
 * 以前このファイルだけが `primaryLinkClassName` と**同名のローカル定数**を持っており、中身は
 * 共通版から `focus-visible` の3クラスが抜けていた。ホームの主操作2本だけキーボード
 * フォーカスの見え方が他画面と違い、しかも名前が同じなので grep でも取り違えやすかった。
 */
export function UpcomingScheduleCard({
  outlook,
  setupPendingHref,
}: {
  outlook: ScheduleOutlook;
  /** 初期設定が未完了のとき、次にやる設定画面のパス。完了していれば undefined。 */
  setupPendingHref?: string;
}) {
  if (outlook.kind === "no_slots") {
    return (
      <Card as="section" className="px-5 py-4">
        <CardTitle>次回の予定</CardTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          定期実行のスケジュールはまだありません。曜日と時刻を決めておくと、下書きの作成や投稿を自動で行えます。
        </p>
        <Link className={`mt-4 ${primaryLinkClassName}`} href="/app/schedule">
          スケジュールを設定
        </Link>
      </Card>
    );
  }

  if (outlook.kind === "all_disabled") {
    return (
      <Card as="section" className="px-5 py-4">
        <CardTitle>次回の予定</CardTitle>
        <p className="mt-2 text-sm text-muted-foreground">
          スケジュールはすべて停止中です。再開するまで自動では実行されません。
        </p>
        <Link className={`mt-4 ${primaryLinkClassName}`} href="/app/schedule">
          スケジュールを確認
        </Link>
      </Card>
    );
  }

  return (
    <Card as="section" className="px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>次回の予定</CardTitle>
        <Link className="text-sm text-primary underline" href="/app/schedule">
          スケジュールを編集
        </Link>
      </div>
      {setupPendingHref ? (
        <Notice className="mt-3" tone="warn">
          初期設定が未完了のため、予定の時刻になっても実行されません。
          <Link className="ml-1 underline" href={setupPendingHref}>
            設定を続ける
          </Link>
        </Notice>
      ) : null}
      <ul className="mt-3 space-y-2">
        {outlook.runs.map((run) => (
          <li
            className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm"
            key={run.slotId}
          >
            <span className="font-medium tabular-nums">{run.label}</span>
            <Badge>{POST_PATTERN_LABELS[run.pattern] ?? run.pattern}</Badge>
            <span className="text-xs text-muted-foreground">
              {MODE_LABEL[run.mode] ?? run.mode}
              {run.imageEnabled ? "・画像あり" : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

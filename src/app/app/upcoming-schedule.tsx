import Link from "next/link";

import type { ScheduleOutlook } from "@/lib/home/overview";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";

/**
 * SC-05 ホームの「次回の予定」（要件06 §1・§10, T-M7-03）。有効スロットの次回実行を早い順に示し、
 * 未登録・全停止それぞれで SC-08 への導線を出す。初期設定が未完了なら、予定があっても実行されない
 * ことを警告して次の設定へ送る（行き止まりを作らない）。表示専用のため server component。
 */

const MODE_LABEL: Record<string, string> = {
  auto: "自動で投稿",
  draft: "下書きを作成",
};

const cardClassName = "rounded-card border border-hairline bg-surface px-5 py-4 shadow-[var(--shadow-card)]";
const primaryLinkClassName =
  "mt-4 inline-flex h-9 items-center justify-center rounded-card bg-brand px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover";

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
      <section className={cardClassName}>
        <h2 className="text-[15px] font-bold text-ink">次回の予定</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          定期実行のスケジュールはまだありません。曜日と時刻を決めておくと、下書きの作成や投稿を自動で行えます。
        </p>
        <Link className={primaryLinkClassName} href="/app/schedule">
          スケジュールを設定
        </Link>
      </section>
    );
  }

  if (outlook.kind === "all_disabled") {
    return (
      <section className={cardClassName}>
        <h2 className="text-[15px] font-bold text-ink">次回の予定</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          スケジュールはすべて停止中です。再開するまで自動では実行されません。
        </p>
        <Link className={primaryLinkClassName} href="/app/schedule">
          スケジュールを確認
        </Link>
      </section>
    );
  }

  return (
    <section className={cardClassName}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">次回の予定</h2>
        <Link className="text-sm text-primary underline" href="/app/schedule">
          スケジュールを編集
        </Link>
      </div>
      {setupPendingHref ? (
        <p className="mt-3 rounded-lg border border-warn-fg/25 bg-warn-bg px-3 py-2 text-sm text-warn-fg">
          初期設定が未完了のため、予定の時刻になっても実行されません。
          <Link className="ml-1 underline" href={setupPendingHref}>
            設定を続ける
          </Link>
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {outlook.runs.map((run) => (
          <li
            className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm"
            key={run.slotId}
          >
            <span className="font-medium tabular-nums">{run.label}</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
              {POST_PATTERN_LABELS[run.pattern] ?? run.pattern}
            </span>
            <span className="text-xs text-muted-foreground">
              {MODE_LABEL[run.mode] ?? run.mode}
              {run.imageEnabled ? "・画像あり" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";
import type { ScheduleSlotView } from "@/lib/schedule-slots";

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 下書きタブに出すスケジュールの概要（T-M8-10）。
 *
 * デザインでは「下書き・スケジュール」が1画面。**URLは変えない**方針なので、どちらのURLでも
 * 両方が見えるようにする。ここは**読み取り専用**で、編集はスケジュール画面へ送る
 * （同じ編集UIを2か所に置くと、片方だけ直す事故が起きる）。
 */
export function ScheduleSummary({ slots }: { slots: ScheduleSlotView[] }) {
  const enabled = slots.filter((s) => s.enabled);

  return (
    <section
      aria-label="スケジュール"
      className="rounded-card border border-hairline bg-surface px-5 py-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-ink">スケジュール</h2>
        <Link
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand underline-offset-2 hover:underline"
          href="/app/schedule"
        >
          <Icon name="tune" size={14} />
          編集する
        </Link>
      </div>

      {slots.length === 0 ? (
        <p className="mt-2 text-[12.5px] leading-5 text-ink-2">
          定期実行のスケジュールはまだありません。曜日と時刻を決めておくと、下書きの作成や投稿を自動で行えます。
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            {slots.map((slot) => (
              <li
                className={`flex flex-wrap items-center gap-2 rounded-card border border-hairline px-3 py-2 ${
                  slot.enabled ? "" : "opacity-55"
                }`}
                key={slot.id}
              >
                {/* DBは `HH:MM:SS` で持つ。秒は運用に意味が無いので落とす（T-M8-24）。 */}
                <span className="text-[18px] font-bold tabular-nums text-ink">
                  {slot.time_jst.slice(0, 5)}
                </span>
                <span className="text-[11.5px] text-ink-2">
                  {slot.weekdays.map((d) => WEEKDAY[d]).join("・")}
                </span>
                <Badge>{POST_PATTERN_LABELS[slot.pattern] ?? slot.pattern}</Badge>
                <Badge tone={slot.mode === "auto" ? "brand" : "neutral"}>
                  {slot.mode === "auto" ? "自動投稿" : "下書きまで"}
                </Badge>
                {slot.enabled ? null : (
                  <span className="text-[11.5px] text-ink-3">停止中</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-3">
            有効なスケジュールは {enabled.length} 件です。実行できる時刻は9:00〜22:00の30分刻みです。
          </p>
        </>
      )}
    </section>
  );
}

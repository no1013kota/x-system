import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { patternLabel } from "@/lib/schedule/slot-labels";

import type { ScheduleSlotView } from "@/lib/schedule-slots";
import { CardTitle, cardClassName } from "@/components/ui/card";
import { slotModeLabel } from "@/lib/schedule/slot-labels";

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 下書きタブに出すスケジュールの概要（T-M8-10）。
 *
 * デザインでは「下書き・スケジュール」が1画面。**URLは変えない**方針なので、どちらのURLでも
 * 両方が見えるようにする。ここは**読み取り専用**で、編集はスケジュール画面へ送る
 * （同じ編集UIを2か所に置くと、片方だけ直す事故が起きる）。
 */
export function ScheduleSummary({ slots }: { slots: ScheduleSlotView[] }) {
  return (
    <section
      aria-label="スケジュール"
      className={`${cardClassName} px-5 py-4`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>スケジュール</CardTitle>
        <Link
          className="inline-flex items-center gap-1 text-caption font-medium text-brand underline-offset-2 hover:underline"
          href="/app/schedule"
        >
          <Icon name="tune" size={14} />
          編集する
        </Link>
      </div>

      {slots.length === 0 ? (
        <p className="mt-2 text-body leading-5 text-ink-2">
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
                <span className="text-caption text-ink-2">
                  {slot.weekdays.map((d) => WEEKDAY[d]).join("・")}
                </span>
                <Badge>{patternLabel(slot.pattern_name)}</Badge>
                <Badge tone={slot.mode === "auto" ? "brand" : "neutral"}>
                  {slotModeLabel(slot.mode)}
                </Badge>
                {slot.enabled ? null : (
                  <span className="text-caption text-ink-3">停止中</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

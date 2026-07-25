"use client";

import { useMemo, useState } from "react";
import { formatJst } from "@/lib/format";
import { POST_PATTERN_LABELS } from "@/lib/post/pattern-labels";

import {
  CHECKPOINT_DAYS,
  aggregateThread,
  type CheckpointDay,
  type DraftAnalytics,
} from "@/lib/analytics";

/**
 * SC-09 投稿実績（tweet_id別・checkpoint切替・スレッド合算, 要件06 §8, T-M5-15）。1/7/30日を切替表示し、
 * スレッド合算は同一checkpoint取得済みIDのみで計算（欠損数併記）。profile_clicks 取得不能は `--`、
 * 30日checkpoint後は「更新終了」。部分失敗は「不完全なthread」、rollback削除IDは監査行として合算除外。
 */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return formatJst(iso);
}

function num(v: number | null): string {
  return v === null ? "--" : v.toLocaleString();
}

export function AnalyticsView({ drafts }: { drafts: DraftAnalytics[] }) {
  // 既定は取得済みの最長checkpoint（全draft横断）。
  const defaultDay = useMemo<CheckpointDay>(() => {
    let best: CheckpointDay = 1;
    for (const d of CHECKPOINT_DAYS) {
      const has = drafts.some((draft) =>
        draft.tweets.some((t) => !t.auditOnly && !t.unavailable && t.checkpoints[String(d)]),
      );
      if (has) best = d;
    }
    return best;
  }, [drafts]);
  const [checkpoint, setCheckpoint] = useState<CheckpointDay>(defaultDay);

  if (drafts.length === 0) {
    return (
      <p className="rounded-xl border bg-background px-4 py-10 text-center text-sm text-muted-foreground">
        まだ投稿実績はありません。投稿すると1日・7日・30日の実績がここに表示されます。
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">表示するcheckpoint:</span>
        <div className="inline-flex rounded-lg border p-0.5">
          {CHECKPOINT_DAYS.map((d) => (
            <button
              className={`rounded-md px-3 py-1 text-sm font-medium ${
                checkpoint === d ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
              key={d}
              onClick={() => setCheckpoint(d)}
              type="button"
            >
              {d}日
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-4">
        {drafts.map((draft) => {
          const agg = aggregateThread(draft, checkpoint);
          return (
            <li className="rounded-xl border bg-background p-4" key={draft.draftId}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                  {POST_PATTERN_LABELS[draft.pattern] ?? draft.pattern}
                </span>
                {draft.incomplete ? (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">不完全なthread</span>
                ) : null}
                {draft.metricsCompleted ? (
                  <span className="rounded px-2 py-0.5 text-xs text-muted-foreground">更新終了</span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">{fmtDate(draft.postedAt)}</span>
              </div>

              {/* スレッド合算（選択checkpoint） */}
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ["インプレッション", agg.impressions],
                  ["いいね", agg.likes],
                  ["リポスト", agg.reposts],
                  ["プロフクリック", agg.profile_clicks],
                ] as const).map(([label, value]) => (
                  <div className="rounded-lg bg-muted/40 px-3 py-2" key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{num(value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                合算対象 {agg.present} 件
                {agg.missing > 0 ? `／${checkpoint}日checkpoint未取得 ${agg.missing} 件` : ""}
              </p>

              {/* tweet_id別 */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">tweet_id</th>
                      <th className="py-1 pr-2 font-medium">Imp</th>
                      <th className="py-1 pr-2 font-medium">いいね</th>
                      <th className="py-1 pr-2 font-medium">RP</th>
                      <th className="py-1 pr-2 font-medium">プロフ</th>
                      <th className="py-1 font-medium">取得日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.tweets.map((t) => {
                      const c = t.checkpoints[String(checkpoint)];
                      return (
                        <tr className="border-b last:border-0" key={t.tweetId}>
                          <td className="py-1 pr-2">
                            <span className="font-mono text-xs">{t.tweetId}</span>
                            {t.auditOnly ? (
                              <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">監査（削除済み）</span>
                            ) : null}
                            {t.unavailable && !t.auditOnly ? (
                              <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">取得不能</span>
                            ) : null}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">{c ? num(c.impressions) : "—"}</td>
                          <td className="py-1 pr-2 tabular-nums">{c ? num(c.likes) : "—"}</td>
                          <td className="py-1 pr-2 tabular-nums">{c ? num(c.reposts) : "—"}</td>
                          <td className="py-1 pr-2 tabular-nums">{c ? num(c.profile_clicks) : "—"}</td>
                          <td className="py-1 text-xs text-muted-foreground">{c ? fmtDate(c.collected_at) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
